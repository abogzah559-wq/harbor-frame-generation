/**
 * Updates from this project's GitHub releases (boost-N).
 *
 * Harbor checks shortly after launch and every 30 minutes. A newer release is
 * downloaded in the background and installed silently when Harbor exits, or
 * right away with "Restart now" (Harbor then opens again on its own). The
 * next launch shows a short green "updated" note.
 */
import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** This build's release number: boost-<HARBOR_BUILD>. Bump it with every release. */
export const HARBOR_BUILD = 8;
export const RELEASES_URL = "https://github.com/abogzah559-wq/harbor-frame-generation/releases";
const API = "https://api.github.com/repos/abogzah559-wq/harbor-frame-generation/releases/latest";
const LAST_BUILD_KEY = "harbor.selfupdate.lastBuild";
const FIRST_CHECK_MS = 15_000;
const CHECK_EVERY_MS = 30 * 60 * 1000;

const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type Asset = { name: string; browser_download_url: string; digest?: string | null };
type Release = { tag_name: string; draft?: boolean; prerelease?: boolean; assets?: Asset[] };

export type SelfUpdateStatus = "idle" | "checking" | "downloading" | "ready" | "uptodate" | "error";
export type SelfUpdateState = {
  status: SelfUpdateStatus;
  /** Release being downloaded or ready to install. */
  tag: string | null;
  /** 0..1 while downloading. */
  progress: number;
  error: string | null;
};

let state: SelfUpdateState = { status: "idle", tag: null, progress: 0, error: null };
const subs = new Set<() => void>();
function set(patch: Partial<SelfUpdateState>) {
  state = { ...state, ...patch };
  subs.forEach((f) => f());
}

export function useSelfUpdate(): SelfUpdateState {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => state,
  );
}

export function buildOfTag(tag: string): number {
  const m = /^boost-(\d+)$/.exec(tag.trim());
  return m ? Number(m[1]) : 0;
}

let running: Promise<void> | null = null;

/** Look for a newer release and download it. Safe to call any time. */
export function checkSelfUpdate(): Promise<void> {
  if (!IS_TAURI || state.status === "ready") return Promise.resolve();
  if (running) return running;
  running = checkOnce()
    .catch((e) => {
      console.warn("[selfupdate] failed", String(e));
      set({ status: "error", error: String(e) });
    })
    .finally(() => {
      running = null;
    });
  return running;
}

async function checkOnce(): Promise<void> {
  set({ status: "checking", error: null });
  const r = await fetch(API, { headers: { Accept: "application/vnd.github+json" }, cache: "no-store" });
  if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
  const rel = (await r.json()) as Release;
  const build = buildOfTag(rel.tag_name);
  const asset = rel.assets?.find((a) => /_x64-setup\.exe$/i.test(a.name));
  if (rel.draft || rel.prerelease || build <= HARBOR_BUILD || !asset) {
    set({ status: "uptodate", tag: null });
    return;
  }
  console.warn("[selfupdate] downloading", rel.tag_name);
  set({ status: "downloading", tag: rel.tag_name, progress: 0 });
  const unlisten = await listen<[number, number]>("selfupdate-progress", (e) => {
    const [done, total] = e.payload;
    if (total > 0) set({ progress: done / total });
  });
  try {
    await invoke<string>("selfupdate_stage", {
      url: asset.browser_download_url,
      sha256: asset.digest ?? null,
      tag: rel.tag_name,
    });
  } finally {
    unlisten();
  }
  console.warn("[selfupdate] ready", rel.tag_name);
  set({ status: "ready", progress: 1 });
}

/** Close Harbor, install the downloaded update and open Harbor again. */
export function installSelfUpdateNow(): void {
  if (state.status !== "ready") return;
  console.warn("[selfupdate] restart to install", state.tag);
  void invoke("selfupdate_install_now").catch((e) => set({ status: "error", error: String(e) }));
}

let started = false;
export function startSelfUpdate(): void {
  if (started || !IS_TAURI || !/Windows/i.test(navigator.userAgent)) return;
  started = true;
  window.setTimeout(() => void checkSelfUpdate(), FIRST_CHECK_MS);
  window.setInterval(() => void checkSelfUpdate(), CHECK_EVERY_MS);
}

/** The release this launch was just updated to, or null (first run / same build). */
export function takeJustUpdated(): string | null {
  let prev: number | null = null;
  try {
    const raw = localStorage.getItem(LAST_BUILD_KEY);
    prev = raw == null ? null : Number(raw);
    localStorage.setItem(LAST_BUILD_KEY, String(HARBOR_BUILD));
  } catch {
    return null;
  }
  return prev != null && prev < HARBOR_BUILD ? `boost-${HARBOR_BUILD}` : null;
}
