import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useSyncExternalStore } from "react";
import { isWindowsDesktop } from "@/lib/platform";
import { t } from "@/lib/i18n";

/**
 * Harbor Boost — frame generation (RIFE through VapourSynth inside mpv) and
 * GPU upscaling (FSR / NIS / CAS shaders), toggled from the player bar.
 *
 * Performance model ("GPU budget"):
 *   1. RIFE's speed is measured once per model/GPU (boost_calibrate, ~4 s):
 *      output fps at 720p and 1080p.
 *   2. For every video the planner picks the processing height and the
 *      output frame rate so RIFE needs at most a set share of that speed,
 *      keeping total GPU use under the user's limit (default 80 %).
 *      Output rates are whole divisors of the screen's refresh rate
 *      (240 Hz → 48 / 60 / 80 fps, 165 Hz → 55 fps) so every frame is shown
 *      for the same number of refreshes: no judder.
 *   3. mpv requests frames from VapourSynth a few at a time
 *      (concurrent-frames) with a deep buffer, so the GPU works at an even
 *      pace instead of 100 % bursts that starve the renderer.
 *   4. If mpv still drops frames, the measured speed is scaled down and the
 *      plan is recomputed (lower fps or resolution).
 */

export type BoostModel = "4.6" | "4.22-lite" | "4.25-lite" | "4.26";

/** Highest height RIFE may work at. Never above 1080p: RIFE ncnn collapses
 *  there (measured 1440p ≈ 1/3, 4K ≈ 1/11 of its 1080p speed). */
export type BoostProcRes = "auto" | "1080" | "720";

/** auto = smoothest rate that fits the GPU budget and matches the screen. */
export type BoostOutMode = "auto" | "fixed" | "target";

export type BoostProfile = {
  frameGeneration: "Off" | "RIFE" | "Smooth";
  fgMode: BoostOutMode;
  multiplier: number;
  target: number;
  model: BoostModel;
  flowScale: number;
  sceneDetect: boolean;
  gpuId: number;
  gpuThreads: number;
  procRes: BoostProcRes;
  /** Upper limit for total GPU use, in percent. */
  maxGpu: number;
  scalingType: "Off" | "FSR" | "NIS" | "CAS";
  sharpness: number;
};

export type BoostConfig = {
  /** Stay on for the next episodes until switched off. */
  remember: boolean;
  profile: BoostProfile;
  /** Settings schema version (2 = GPU budget planner). */
  v?: number;
};

export const DEFAULT_BOOST_PROFILE: BoostProfile = {
  frameGeneration: "RIFE",
  fgMode: "auto",
  multiplier: 2,
  target: 60,
  model: "4.6",
  flowScale: 100,
  sceneDetect: true,
  gpuId: -1,
  gpuThreads: 3,
  procRes: "auto",
  maxGpu: 80,
  scalingType: "FSR",
  sharpness: 9,
};

export const DEFAULT_BOOST_CONFIG: BoostConfig = {
  remember: true,
  profile: DEFAULT_BOOST_PROFILE,
  v: 2,
};

export const BOOST_MODELS: Array<{ id: BoostModel; label: string; note: string }> = [
  { id: "4.6", label: "RIFE 4.6", note: "Fastest" },
  { id: "4.22-lite", label: "RIFE 4.22 Lite", note: "Fast" },
  { id: "4.25-lite", label: "RIFE 4.25 Lite", note: "Balanced" },
  { id: "4.26", label: "RIFE 4.26", note: "Best quality" },
];

export type BoostStatus = {
  supported: boolean;
  runtime: boolean;
  rife: boolean;
  models: string[];
  shaders: boolean;
  primed: boolean | null;
  primeError: string | null;
};

export type BoostProgress = { step: string; done: number; total: number };

/** What Boost is doing for the current video (shown in the settings panel). */
export type BoostPlan = {
  srcHeight: number;
  srcFps: number;
  refresh: number;
  height: number;
  outFps: number;
  /** Estimated total GPU use in percent. */
  gpu: number;
  /** RIFE fps this GPU reaches at 1080p (after any slow-down corrections). */
  speed1080: number;
  overBudget: boolean;
};

type State = {
  config: BoostConfig;
  on: boolean;
  busy: boolean;
  calibrating: boolean;
  progress: BoostProgress | null;
  error: string | null;
  /** Neutral, non-error message (e.g. "Boost lowered its load"). */
  notice: string | null;
  plan: BoostPlan | null;
};

const STORAGE_KEY = "harbor.boost.v1";
const ON_KEY = "harbor.boost.on";

function migrate(p: Partial<BoostProfile>, v: number | undefined): Partial<BoostProfile> {
  const out = { ...p } as Partial<BoostProfile>;
  const raw = p as Record<string, unknown>;
  if (!v || v < 2) {
    // v1 → v2: "adaptive" split into auto / target; 1440p processing removed
    // (RIFE ncnn collapses above 1080p); 3 GPU threads measured fastest.
    if (raw.fgMode === "adaptive") out.fgMode = Number(raw.target ?? 0) > 0 ? "target" : "auto";
    else if (raw.fgMode === "fixed") out.fgMode = "auto";
    if (Number(raw.gpuThreads ?? 2) <= 2) out.gpuThreads = 3;
  }
  if (!["auto", "1080", "720"].includes(String(raw.procRes ?? "auto"))) out.procRes = "auto";
  if (!["auto", "fixed", "target"].includes(String(out.fgMode ?? "auto"))) out.fgMode = "auto";
  return out;
}

function load(): BoostConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<BoostConfig>;
      return {
        ...DEFAULT_BOOST_CONFIG,
        ...p,
        v: 2,
        profile: { ...DEFAULT_BOOST_PROFILE, ...migrate(p.profile ?? {}, p.v) },
      };
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_BOOST_CONFIG;
}

function loadOn(cfg: BoostConfig): boolean {
  if (!cfg.remember) return false;
  try {
    return localStorage.getItem(ON_KEY) === "1";
  } catch {
    return false;
  }
}

const initialConfig = load();
let state: State = {
  config: initialConfig,
  on: loadOn(initialConfig),
  busy: false,
  calibrating: false,
  progress: null,
  error: null,
  notice: null,
  plan: null,
};
const listeners = new Set<() => void>();

function setState(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useBoost(): State {
  return useSyncExternalStore(subscribe, () => state);
}

export function boostSupported(): boolean {
  return isWindowsDesktop();
}

function errText(e: unknown): string {
  return typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
}

function persistOn(on: boolean) {
  try {
    localStorage.setItem(ON_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function boostStatus(): Promise<BoostStatus> {
  return invoke<BoostStatus>("boost_status");
}

// ---------------------------------------------------------------------------
// Host (player) settings we must restore when switching off
// ---------------------------------------------------------------------------

type Host = { hwdec: "auto" | "on" | "off"; motionInterp: boolean };
let host: Host = { hwdec: "auto", motionInterp: false };

export function boostSetHost(h: Host) {
  host = h;
}

function hostHwdec(): string {
  return host.hwdec === "on" ? "yes" : host.hwdec === "off" ? "no" : "auto-copy";
}

/** Only touch hwdec when the user's mode can't feed VapourSynth (avoids a decoder reinit). */
async function hwdecForFg() {
  if (host.hwdec === "on") await mpvSet("hwdec", "auto-copy").catch(() => {});
}
async function hwdecRestore() {
  if (host.hwdec === "on") await mpvSet("hwdec", hostHwdec()).catch(() => {});
}

// ---------------------------------------------------------------------------
// Keep the playback position across filter changes
// ---------------------------------------------------------------------------

let lastPos = 0;
let lastPosAt = 0;
async function readPos(): Promise<number> {
  const v = await invoke("mpv_get_property", { name: "time-pos" }).catch(() => null);
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Called right before a filter change: silence end-file errors briefly and
 *  jump back to where the viewer was if mpv restarts from the top. */
async function guardPosition() {
  const pos = await readPos();
  console.warn("[boost] guard", { pos, lastPos, fresh: Date.now() - lastPosAt });
  // Fall back to the watchdog's reading only if it is fresh (same episode).
  const keep = pos > 0 ? pos : Date.now() - lastPosAt < 4000 ? lastPos : 0;
  (window as { __harborBoostQuietUntil?: number }).__harborBoostQuietUntil = Date.now() + 15_000;
  if (keep < 5) return;
  for (const delay of [800, 2000, 4000, 7000]) {
    window.setTimeout(async () => {
      const now = await readPos();
      if (now + 8 < keep) {
        console.warn("[boost] restoring position", { now, keep });
        await mpvCmd(["seek", keep, "absolute", "exact"]).catch(() => {});
      }
    }, delay);
  }
}

// ---------------------------------------------------------------------------
// Calibration (measured RIFE speed) + slow-down corrections
// ---------------------------------------------------------------------------

type Calib = { fps720: number; fps1080: number };

const SCALE_KEY = "harbor.boost.speedscale.v2";
const calibCache = new Map<string, Calib>();
const calibPending = new Map<string, Promise<Calib>>();

function calibKey(p: BoostProfile) {
  return `${p.model}|${p.gpuId}|${p.gpuThreads}`;
}

function loadScales(): Record<string, number> {
  try {
    const v = JSON.parse(localStorage.getItem(SCALE_KEY) ?? "{}") as unknown;
    return v && typeof v === "object" ? (v as Record<string, number>) : {};
  } catch {
    return {};
  }
}
let speedScale: Record<string, number> = loadScales();
function saveScales() {
  try {
    localStorage.setItem(SCALE_KEY, JSON.stringify(speedScale));
  } catch {
    /* ignore */
  }
}

async function calibrate(p: BoostProfile, force = false): Promise<Calib> {
  const key = calibKey(p);
  const hit = calibCache.get(key);
  if (hit && !force) return hit;
  const pending = calibPending.get(key);
  if (pending) return pending;
  const run = (async () => {
    setState({ calibrating: true });
    try {
      const c = await invoke<Calib>("boost_calibrate", {
        model: p.model,
        gpuId: p.gpuId,
        threads: p.gpuThreads,
        force,
      });
      console.warn("[boost] calibration", { key, ...c });
      calibCache.set(key, c);
      return c;
    } finally {
      calibPending.delete(key);
      setState({ calibrating: false });
    }
  })();
  calibPending.set(key, run);
  return run;
}

/** Measure this GPU again (e.g. after a driver or graphics card change). */
export async function boostRecalibrate(): Promise<void> {
  const p = state.config.profile;
  delete speedScale[calibKey(p)];
  saveScales();
  planSig = "";
  await calibrate(p, true);
  if (state.on) await runSync();
}

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------

type Media = { srcHeight: number; srcFps: number; refresh: number };

/** RIFE output fps at height h. ncnn scales ~h^-2 up to 1080p and collapses
 *  above it (measured: 1440p ≈ 1/3, 2160p ≈ 1/11 of the 1080p speed). */
function speedAt(c: Calib, h: number): number {
  const e = Math.log(c.fps720 / c.fps1080) / Math.log(1080 / 720);
  const k = Number.isFinite(e) && e > 1 && e < 4 ? e : 2;
  return c.fps1080 * Math.pow(1080 / h, h > 1080 ? 3.5 : k);
}

function plan(p: BoostProfile, c: Calib, m: Media): BoostPlan & { maxHeight: number } {
  const scale = speedScale[calibKey(p)] ?? 1;
  const src = m.srcFps > 1 ? m.srcFps : 23.976;
  const refresh = m.refresh > 20 ? Math.round(m.refresh) : 60;
  const sh = m.srcHeight > 0 ? m.srcHeight : 1080;

  // Highest height allowed by the user's choice, then lower steps the
  // planner may fall back to: the GPU limit always wins.
  const top = Math.min(sh, p.procRes === "720" ? 720 : 1080);
  const heights = [...new Set([top, 900, 720, 540].filter((h) => h <= top))];
  if (heights.length === 0) heights.push(sh);

  // Share of RIFE's full speed we allow: leaves room for decoding, the
  // renderer and upscaling under the user's limit.
  const share = Math.min(0.85, Math.max(0.25, (p.maxGpu - 15) / 90));
  const speed = (h: number) => speedAt(c, h) * scale * (h < sh ? 0.8 : 1);

  // Output rates that are whole divisors of the refresh rate (even pacing).
  const divisors: number[] = [];
  for (let k = 1; k <= 12; k++) {
    const f = refresh / k;
    if (f >= src * 1.9 && f <= src * 5) divisors.push(f);
  }
  if (divisors.length === 0) divisors.push(Math.min(refresh, src * 2));

  const userRate =
    p.fgMode === "fixed"
      ? src * Math.min(4, Math.max(2, p.multiplier))
      : p.fgMode === "target"
        ? Math.min(Math.max(30, p.target), refresh)
        : null;

  const pick = (h: number, auto: boolean): number | null => {
    const budget = share * speed(h);
    if (!auto && userRate != null) return userRate <= budget ? userRate : null;
    const fit = divisors.filter((f) => f <= budget);
    return fit.length ? Math.max(...fit) : null;
  };

  // 1) the user's own rate, at the highest height that fits;
  // 2) otherwise the smoothest even-paced rate that fits;
  // 3) otherwise the lightest possible plan (and say so).
  let height = heights[heights.length - 1];
  let out: number | null = null;
  for (const auto of userRate == null ? [true] : [false, true]) {
    for (const h of heights) {
      const f = pick(h, auto);
      if (f != null) {
        height = h;
        out = f;
        break;
      }
    }
    if (out != null) break;
  }
  const overBudget = out == null;
  if (out == null) out = Math.min(...divisors);
  const gpu = Math.min(100, Math.round((out / speed(height)) * 90 + 15));
  return {
    srcHeight: sh,
    srcFps: src,
    refresh,
    height,
    maxHeight: height < sh ? height : 0,
    outFps: Math.round(out * 100) / 100,
    gpu,
    speed1080: Math.round(c.fps1080 * scale),
    overBudget,
  };
}

// ---------------------------------------------------------------------------
// mpv application
// ---------------------------------------------------------------------------

const VF_LABEL = "@harborfg";
let appliedShader: string | null = null;
let appliedVf: string | null = null;
let appliedSmooth = false;
let appliedSync = false;
let fgFailed = false;
let vfAppliedAt = 0;
let planSig = "";
let lastPlan: (BoostPlan & { maxHeight: number }) | null = null;
let lag: { at: number; drops: number; bad: number } | null = null;
let overNotice = false;

const mpvSet = (name: string, value: unknown) => invoke("mpv_set_property", { name, value });
const norm = (v: string) => v.replace(/\\\\/g, "/").replace(/\\/g, "/").toLowerCase();
async function mpvGet(name: string): Promise<string> {
  const v = await invoke("mpv_get_property", { name }).catch(() => "");
  return norm(typeof v === "string" ? v : JSON.stringify(v ?? ""));
}
const mpvCmd = (cmd: unknown[]) => invoke("mpv_command", { cmd });

async function numProp(name: string): Promise<number> {
  const v = await invoke("mpv_get_property", { name }).catch(() => null);
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : NaN;
}

async function readMedia(): Promise<Media | null> {
  const srcHeight = await numProp("height");
  if (!(srcHeight > 0)) return null;
  let srcFps = await numProp("container-fps");
  if (!(srcFps > 1)) srcFps = 23.976;
  let refresh = await numProp("display-fps");
  if (!(refresh > 20)) refresh = await numProp("estimated-display-fps");
  if (!(refresh > 20)) refresh = 60;
  return { srcHeight, srcFps: Math.round(srcFps * 1000) / 1000, refresh: Math.round(refresh) };
}

async function removeAll() {
  if (appliedShader) {
    await mpvCmd(["change-list", "glsl-shaders", "remove", appliedShader]).catch(() => {});
    appliedShader = null;
  }
  if (appliedVf) {
    await guardPosition();
    await mpvCmd(["vf", "remove", VF_LABEL]).catch(() => {});
    await hwdecRestore();
    appliedVf = null;
  }
  await restoreSync();
  if (appliedSmooth) {
    if (!host.motionInterp) {
      await mpvSet("interpolation", false).catch(() => {});
      await mpvSet("video-sync", "audio").catch(() => {});
    }
    appliedSmooth = false;
  }
  setState({ plan: null });
}

async function restoreSync() {
  if (!appliedSync) return;
  if (!host.motionInterp && !appliedSmooth) await mpvSet("video-sync", "audio").catch(() => {});
  appliedSync = false;
}

async function wantedShader(p: BoostProfile): Promise<string | null> {
  if (p.scalingType === "Off") return null;
  return invoke<string>("boost_shader", { kind: p.scalingType, sharpness: p.sharpness });
}

async function wantedVf(p: BoostProfile): Promise<string | null> {
  if (p.frameGeneration !== "RIFE" || fgFailed) return null;
  const media = await readMedia();
  if (!media) return appliedVf; // no video yet: keep whatever is there
  const c = await calibrate(p);
  const sig = JSON.stringify([calibKey(p), p.fgMode, p.multiplier, p.target, p.procRes, p.maxGpu, media, speedScale[calibKey(p)] ?? 1]);
  if (sig !== planSig || !lastPlan) {
    lastPlan = plan(p, c, media);
    planSig = sig;
    setState({ plan: lastPlan });
    if (lastPlan.overBudget && !overNotice) {
      overNotice = true;
      setState({ notice: t("Your GPU can't reach this output with these settings. Try RIFE 4.6 or Auto output.") });
    }
  }
  const pl = lastPlan;
  // Always hand RIFE the planned output rate (it may differ from the user's
  // multiplier when that would exceed the GPU limit).
  const path = await invoke<string>("boost_framegen_script", {
    opts: {
      model: p.model,
      mode: "adaptive",
      multiplier: p.multiplier,
      target: pl.outFps,
      flowScale: p.flowScale,
      sceneDetect: p.sceneDetect,
      gpuId: p.gpuId,
      gpuThreads: p.gpuThreads,
      maxHeight: pl.maxHeight,
    },
  });
  return path.replace(/\\/g, "/");
}

/** Make mpv match the current config (adds what's missing, removes what's stale). */
async function sync(): Promise<void> {
  if (!state.on) {
    await removeAll();
    return;
  }
  const p = state.config.profile;

  const shader = await wantedShader(p);
  const curShaders = await mpvGet("glsl-shaders");
  if (appliedShader && (appliedShader !== shader || !curShaders.includes(norm(appliedShader)))) {
    await mpvCmd(["change-list", "glsl-shaders", "remove", appliedShader]).catch(() => {});
    appliedShader = null;
  }
  if (shader && !curShaders.includes(norm(shader))) {
    await mpvCmd(["change-list", "glsl-shaders", "append", shader]);
  }
  appliedShader = shader;

  const vf = await wantedVf(p);
  const vfPresent = (await mpvGet("vf")).includes("harborfg");
  if (vf) {
    if (appliedVf !== vf || !vfPresent) {
      await guardPosition();
      if (vfPresent) await mpvCmd(["vf", "remove", VF_LABEL]).catch(() => {});
      await hwdecForFg();
      // A few frames in flight + a deep buffer: steady GPU load, no bursts.
      const conc = Math.min(6, p.gpuThreads + 1);
      await mpvCmd(["vf", "add", `${VF_LABEL}:vapoursynth=file=[${vf}]:buffered-frames=10:concurrent-frames=${conc}`]);
      appliedVf = vf;
      vfAppliedAt = Date.now();
      lag = null;
      console.warn("[boost] apply", { model: p.model, threads: p.gpuThreads, plan: lastPlan });
    }
    if (!appliedSync) {
      // Output fps divides the refresh rate: lock video to the display.
      await mpvSet("video-sync", "display-resample").catch(() => {});
      appliedSync = true;
    }
  } else if (appliedVf || vfPresent) {
    await guardPosition();
    await mpvCmd(["vf", "remove", VF_LABEL]).catch(() => {});
    await hwdecRestore();
    appliedVf = null;
    await restoreSync();
    setState({ plan: null });
  }

  const smooth = p.frameGeneration === "Smooth";
  if (smooth) {
    await mpvSet("video-sync", "display-resample").catch(() => {});
    await mpvSet("interpolation", true).catch(() => {});
    await mpvSet("tscale", "oversample").catch(() => {});
    appliedSmooth = true;
  } else if (appliedSmooth) {
    if (!host.motionInterp) {
      await mpvSet("interpolation", false).catch(() => {});
      if (!appliedSync) await mpvSet("video-sync", "audio").catch(() => {});
    }
    appliedSmooth = false;
  }
}

// ---------------------------------------------------------------------------
// Lag monitor: if mpv still drops frames / drifts from audio, the GPU is
// slower than measured right now (other apps, thermals): lower the plan.
// ---------------------------------------------------------------------------

async function checkLag() {
  const p = state.config.profile;
  if (!state.on || state.busy || p.frameGeneration !== "RIFE" || !appliedVf) {
    lag = null;
    return;
  }
  if (Date.now() - vfAppliedAt < 8000 || (await mpvGet("pause")) === "yes") {
    lag = null;
    return;
  }
  const drops = await numProp("frame-drop-count");
  if (!Number.isFinite(drops)) return;
  const avsync = Math.abs(await numProp("avsync"));
  const now = Date.now();
  if (!lag) {
    lag = { at: now, drops, bad: 0 };
    return;
  }
  const dt = Math.max(0.5, (now - lag.at) / 1000);
  const rate = (drops - lag.drops) / dt;
  const lagging = rate > 1.5 || (Number.isFinite(avsync) && avsync > 0.25);
  lag = { at: now, drops, bad: lagging ? lag.bad + 1 : 0 };
  if (lag.bad < 3) return;
  lag = null;

  const key = calibKey(p);
  const before = speedScale[key] ?? 1;
  if (before <= 0.35) return;
  speedScale[key] = Math.max(0.35, before * 0.8);
  saveScales();
  console.warn("[boost] lagging", { rate: Number(rate.toFixed(1)), avsync, scale: speedScale[key], plan: lastPlan });
  setState({ notice: t("Boost lowered its load to keep playback smooth.") });
  await runSync();
}

let syncing: Promise<void> | null = null;
function runSync(): Promise<void> {
  if (syncing) return syncing;
  syncing = sync()
    .catch((e) => {
      setState({ error: errText(e) });
    })
    .finally(() => {
      syncing = null;
    });
  return syncing;
}

/** Download whatever the current profile needs, with progress. */
async function ensureInstalled(p: BoostProfile): Promise<void> {
  const s = await boostStatus();
  const needFg = p.frameGeneration === "RIFE";
  const needShaders = p.scalingType !== "Off";
  const missing =
    (needShaders && !s.shaders) || (needFg && (!s.runtime || !s.rife || !s.models.includes(p.model)));
  if (!missing) return;
  const unlisten = await listen<BoostProgress>("boost-progress", (e) => setState({ progress: e.payload }));
  try {
    setState({ progress: { step: "Preparing", done: 0, total: 0 } });
    await invoke("boost_install", { framegen: needFg, model: p.model });
  } finally {
    unlisten();
    setState({ progress: null });
  }
}

export async function boostSetOn(on: boolean): Promise<void> {
  if (!boostSupported() || state.busy) return;
  setState({ busy: true, error: null });
  try {
    if (on) {
      fgFailed = false;
      await ensureInstalled(state.config.profile);
    }
    setState({ on });
    persistOn(on);
    await runSync();
  } catch (e) {
    setState({ on: false, error: errText(e) });
    persistOn(false);
    await removeAll().catch(() => {});
  } finally {
    setState({ busy: false });
  }
}

export function boostToggle(): Promise<void> {
  return boostSetOn(!state.on);
}

export async function boostSaveConfig(config: BoostConfig): Promise<void> {
  const next = { ...config, v: 2 };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  fgFailed = false;
  overNotice = false;
  planSig = "";
  setState({ config: next, error: null, notice: null });
  if (!next.remember) persistOn(false);
  if (state.on && boostSupported()) {
    setState({ busy: true });
    try {
      await ensureInstalled(next.profile);
      await runSync();
    } catch (e) {
      setState({ error: errText(e) });
    } finally {
      setState({ busy: false });
    }
  }
}

export function boostClearError() {
  setState({ error: null });
}

export function boostClearNotice() {
  setState({ notice: null });
}

/** Called by the player control while mounted: keeps mpv in sync across episode
 *  changes / player restarts, and reacts to VapourSynth failures. */
export function boostAttach(): () => void {
  if (!boostSupported()) return () => {};
  // A fresh mpv instance has none of our filters yet.
  lastPos = 0;
  lastPosAt = 0;
  appliedShader = null;
  appliedVf = null;
  appliedSmooth = false;
  appliedSync = false;
  planSig = "";
  lastPlan = null;
  lag = null;
  overNotice = false;
  const onVsError = (e: Event) => {
    if (!state.on || state.config.profile.frameGeneration !== "RIFE" || fgFailed) return;
    fgFailed = true;
    const detail = String((e as CustomEvent).detail ?? "").trim();
    setState({ error: `${t("Frame generation failed to start")}${detail ? `: ${detail}` : ""}` });
    void guardPosition().then(() => mpvCmd(["vf", "remove", VF_LABEL]).catch(() => {}));
    void hwdecRestore();
    appliedVf = null;
  };
  window.addEventListener("harbor:vapoursynth-error", onVsError);
  let ready = !state.on;
  const id = window.setInterval(() => {
    void readPos().then((p) => {
      lastPos = p;
      lastPosAt = Date.now();
      if (p > 0.5) ready = true;
    });
    // The watchdog only re-applies once playback is under way (see above).
    if (ready && state.on && !state.busy && startTimer == null) {
      void runSync().then(() => checkLag());
    }
  }, 2500);
  let startTimer: number | null = null;
  if (state.on) {
    // Remembered from the previous episode: wait until the episode is really
    // playing (first frames shown, resume seek done) before adding filters,
    // otherwise Harbor's "no video yet" watchdog would switch streams.
    const started = Date.now();
    const waitForPlayback = async () => {
      startTimer = null;
      if (!state.on) return;
      const w = Number(await invoke("mpv_get_property", { name: "width" }).catch(() => 0)) || 0;
      const pos = await readPos();
      if ((w > 0 && pos > 0.5) || Date.now() - started > 60_000) {
        if (state.busy) return;
        (window as { __harborBoostQuietUntil?: number }).__harborBoostQuietUntil = Date.now() + 15_000;
        void ensureInstalled(state.config.profile)
          .then(() => runSync())
          .catch((e) => setState({ on: false, error: errText(e) }));
        return;
      }
      startTimer = window.setTimeout(() => void waitForPlayback(), 1000);
    };
    startTimer = window.setTimeout(() => void waitForPlayback(), 1500);
  }
  return () => {
    window.removeEventListener("harbor:vapoursynth-error", onVsError);
    window.clearInterval(id);
    if (startTimer != null) window.clearTimeout(startTimer);
    appliedShader = null;
    appliedVf = null;
    appliedSmooth = false;
    appliedSync = false;
    setState({ plan: null });
    if (!state.config.remember && state.on) {
      setState({ on: false });
      persistOn(false);
    }
  };
}
