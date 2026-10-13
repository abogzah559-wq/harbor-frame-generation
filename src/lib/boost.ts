import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useSyncExternalStore } from "react";
import { isWindowsDesktop } from "@/lib/platform";

/**
 * Harbor Boost — frame generation (RIFE through VapourSynth inside mpv) and
 * GPU upscaling (FSR / NIS / CAS shaders), toggled from the player bar.
 * Nothing runs outside Harbor's own mpv.
 */

export type BoostModel = "4.6" | "4.22-lite" | "4.25-lite" | "4.26";

export type BoostProfile = {
  frameGeneration: "Off" | "RIFE" | "Smooth";
  fgMode: "fixed" | "adaptive";
  multiplier: number;
  target: number;
  model: BoostModel;
  flowScale: number;
  sceneDetect: boolean;
  gpuId: number;
  gpuThreads: number;
  scalingType: "Off" | "FSR" | "NIS" | "CAS";
  sharpness: number;
};

export type BoostConfig = {
  /** Stay on for the next episodes until switched off. */
  remember: boolean;
  profile: BoostProfile;
};

export const DEFAULT_BOOST_PROFILE: BoostProfile = {
  frameGeneration: "RIFE",
  fgMode: "fixed",
  multiplier: 2,
  target: 60,
  model: "4.6",
  flowScale: 100,
  sceneDetect: true,
  gpuId: -1,
  gpuThreads: 2,
  scalingType: "FSR",
  sharpness: 9,
};

export const DEFAULT_BOOST_CONFIG: BoostConfig = {
  remember: true,
  profile: DEFAULT_BOOST_PROFILE,
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

type State = {
  config: BoostConfig;
  on: boolean;
  busy: boolean;
  progress: BoostProgress | null;
  error: string | null;
};

const STORAGE_KEY = "harbor.boost.v1";
const ON_KEY = "harbor.boost.on";

function load(): BoostConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<BoostConfig>;
      return { ...DEFAULT_BOOST_CONFIG, ...p, profile: { ...DEFAULT_BOOST_PROFILE, ...(p.profile ?? {}) } };
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
let state: State = { config: initialConfig, on: loadOn(initialConfig), busy: false, progress: null, error: null };
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
// mpv application
// ---------------------------------------------------------------------------

const VF_LABEL = "@harborfg";
let appliedShader: string | null = null;
let appliedVf: string | null = null;
let appliedSmooth = false;
let fgFailed = false;

const mpvSet = (name: string, value: unknown) => invoke("mpv_set_property", { name, value });
const norm = (v: string) => v.replace(/\\\\/g, "/").replace(/\\/g, "/").toLowerCase();
async function mpvGet(name: string): Promise<string> {
  const v = await invoke("mpv_get_property", { name }).catch(() => "");
  return norm(typeof v === "string" ? v : JSON.stringify(v ?? ""));
}
const mpvCmd = (cmd: unknown[]) => invoke("mpv_command", { cmd });

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
  if (appliedSmooth) {
    if (!host.motionInterp) {
      await mpvSet("interpolation", false).catch(() => {});
      await mpvSet("video-sync", "audio").catch(() => {});
    }
    appliedSmooth = false;
  }
}

async function wantedShader(p: BoostProfile): Promise<string | null> {
  if (p.scalingType === "Off") return null;
  return invoke<string>("boost_shader", { kind: p.scalingType, sharpness: p.sharpness });
}

async function wantedVf(p: BoostProfile): Promise<string | null> {
  if (p.frameGeneration !== "RIFE" || fgFailed) return null;
  const path = await invoke<string>("boost_framegen_script", {
    opts: {
      model: p.model,
      mode: p.fgMode,
      multiplier: p.multiplier,
      target: p.target,
      flowScale: p.flowScale,
      sceneDetect: p.sceneDetect,
      gpuId: p.gpuId,
      gpuThreads: p.gpuThreads,
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
      await mpvCmd(["vf", "add", `${VF_LABEL}:vapoursynth=[${vf}]`]);
      appliedVf = vf;
    }
  } else if (appliedVf || vfPresent) {
    await guardPosition();
    await mpvCmd(["vf", "remove", VF_LABEL]).catch(() => {});
    await hwdecRestore();
    appliedVf = null;
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
      await mpvSet("video-sync", "audio").catch(() => {});
    }
    appliedSmooth = false;
  }
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
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    /* ignore */
  }
  fgFailed = false;
  setState({ config, error: null });
  if (!config.remember) persistOn(false);
  if (state.on && boostSupported()) {
    setState({ busy: true });
    try {
      await ensureInstalled(config.profile);
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
  const onVsError = (e: Event) => {
    if (!state.on || state.config.profile.frameGeneration !== "RIFE" || fgFailed) return;
    fgFailed = true;
    const detail = String((e as CustomEvent).detail ?? "").trim();
    setState({ error: `Frame generation failed to start${detail ? `: ${detail}` : ""}` });
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
    if (ready && state.on && !state.busy && startTimer == null) void runSync();
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
    if (!state.config.remember && state.on) {
      setState({ on: false });
      persistOn(false);
    }
  };
}
