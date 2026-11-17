import { invoke } from "@tauri-apps/api/core";
import { stopFullDownload } from "./full-download";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export type EngineStatus = {
  ready: boolean;
  port: number | null;
  active_torrents: number;
  last_error: string | null;
  dht_tier?: number;
  dht_nodes?: number;
};

export type EngineFile = {
  idx: number;
  name: string;
  length: number;
};

export type AddResult = {
  info_hash: string;
  files: EngineFile[];
  stream_base: string;
};

export type TorrentEngineStats = {
  peers: number;
  unchoked: number;
  downloaded: number;
  downloadSpeed: number;
  streamProgress: number;
  streamLen: number;
  peerSearchRunning: boolean;
  finished: boolean;
  state: string;
};

export type SelfTestStep = {
  label: string;
  ok: boolean;
  warn?: boolean;
  detail: string;
};

export type SelfTestResult = {
  pass: boolean;
  steps: SelfTestStep[];
};

export async function torrentEngineStatus(): Promise<EngineStatus | null> {
  if (!isTauri) return null;
  try {
    return await invoke<EngineStatus>("torrent_engine_status");
  } catch {
    return null;
  }
}

let lastAddError: string | null = null;

export function lastEngineAddError(): string | null {
  return lastAddError;
}

export async function torrentEngineAdd(
  magnet: string,
  trackers: string[],
  fileIdx?: number,
): Promise<AddResult | null> {
  if (!isTauri) return null;
  try {
    lastAddError = null;
    return await invoke<AddResult>("torrent_engine_add", {
      magnet,
      trackers,
      fileIdx: typeof fileIdx === "number" && fileIdx >= 0 ? fileIdx : null,
    });
  } catch (e) {
    lastAddError = String(e);
    console.warn("[engine] add failed", e);
    return null;
  }
}

export async function torrentEngineSelect(infoHash: string, fileIdx: number): Promise<void> {
  if (!isTauri) return;
  await invoke("torrent_engine_select", { infoHash, fileIdx }).catch((e) =>
    console.warn("[engine] select failed", e),
  );
}

export async function torrentEngineStats(
  infoHash: string,
  fileIdx: number | null,
): Promise<TorrentEngineStats | null> {
  if (!isTauri) return null;
  try {
    return await invoke<TorrentEngineStats>("torrent_engine_stats", { infoHash, fileIdx });
  } catch {
    return null;
  }
}

export async function torrentEngineRemove(infoHash: string, deleteFiles: boolean): Promise<void> {
  if (!isTauri) return;
  stopFullDownload(infoHash);
  await invoke("torrent_engine_remove", { infoHash, deleteFiles }).catch((e) =>
    console.warn("[engine] remove failed", e),
  );
}

export type FastEngineNet = {
  mode: "direct" | "socks5" | "wireguard";
  socksHost: string;
  socksPort: number;
  socksUser: string;
  socksPass: string;
  wireguardConf: string;
  allowIpv6: boolean;
};

export type FastEngineState = {
  enabled: boolean;
  running: boolean;
  net: FastEngineNet;
  status: {
    mode: string;
    state: { kind: string; reason?: string };
    endpoint: string | null;
    trafficAllowed: boolean;
    killSwitchEngaged: boolean;
  } | null;
};

export async function fastEngineGet(): Promise<FastEngineState | null> {
  if (!isTauri) return null;
  try {
    return await invoke<FastEngineState>("torrent_engine_fast_get");
  } catch {
    return null;
  }
}

export async function fastEngineSet(enabled: boolean, net: FastEngineNet): Promise<FastEngineState> {
  return invoke<FastEngineState>("torrent_engine_fast_set", { enabled, net });
}

/** Tells the fast engine where the player is, so it fetches what comes next
 *  (and the exact spot after a seek) first. */
export function torrentEnginePlayhead(infoHash: string, fileIdx: number, position: number, duration: number | null): void {
  if (!isTauri) return;
  void invoke("torrent_engine_playhead", {
    infoHash,
    fileIdx,
    position,
    duration: duration && duration > 0 ? duration : null,
  }).catch(() => {});
}

/** `{hash, file}` of a local engine stream URL (`…/stream/<hash>/<file>`). */
export function parseEngineStreamUrl(url: string | null | undefined): { infoHash: string; fileIdx: number } | null {
  const m = url?.match(/\/stream\/([0-9a-fA-F]{40})\/(\d+)(?:[/?#]|$)/);
  return m ? { infoHash: m[1].toLowerCase(), fileIdx: Number(m[2]) } : null;
}

const pendingRemovals = new Map<string, number>();

export function scheduleTorrentRemoval(infoHash: string, deleteFiles = false, delayMs = 1200): void {
  if (!isTauri) return;
  cancelTorrentRemoval(infoHash);
  const id = window.setTimeout(() => {
    pendingRemovals.delete(infoHash);
    void torrentEngineRemove(infoHash, deleteFiles);
  }, delayMs);
  pendingRemovals.set(infoHash, id);
}

export function cancelTorrentRemoval(infoHash: string): void {
  const id = pendingRemovals.get(infoHash);
  if (id != null) {
    window.clearTimeout(id);
    pendingRemovals.delete(infoHash);
  }
}

export async function torrentEngineSelfTest(): Promise<SelfTestResult | null> {
  if (!isTauri) return null;
  try {
    return await invoke<SelfTestResult>("torrent_engine_selftest");
  } catch (e) {
    console.warn("[engine] selftest failed", e);
    return null;
  }
}

export async function torrentEngineRestart(): Promise<EngineStatus | null> {
  if (!isTauri) return null;
  try {
    return await invoke<EngineStatus>("torrent_engine_restart");
  } catch (e) {
    console.warn("[engine] restart failed", e);
    return null;
  }
}

export async function torrentEngineHardReset(): Promise<EngineStatus | null> {
  if (!isTauri) return null;
  try {
    return await invoke<EngineStatus>("torrent_engine_hard_reset");
  } catch (e) {
    console.warn("[engine] hard reset failed", e);
    return null;
  }
}

export async function torrentEngineSetOptions(
  dir: string | null,
  retentionHours: number,
  maxGb: number,
  restart: boolean,
): Promise<void> {
  if (!isTauri) return;
  await invoke("torrent_engine_set_options", { dir, retentionHours, maxGb, restart }).catch((e) =>
    console.warn("[engine] set options failed", e),
  );
}

