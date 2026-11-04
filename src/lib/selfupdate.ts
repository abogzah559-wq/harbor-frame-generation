/**
 * Silent updates from this project's GitHub releases (boost-N).
 *
 * While Harbor runs it checks for a newer release, downloads the installer in
 * the background and hands it to a small helper that installs it once Harbor
 * is closed. The next launch shows a short green "updated" note.
 */
import { invoke } from "@tauri-apps/api/core";

/** This build's release number: boost-<HARBOR_BUILD>. Bump it with every release. */
export const HARBOR_BUILD = 6;
export const RELEASES_URL = "https://github.com/abogzah559-wq/harbor-frame-generation/releases";
const API = "https://api.github.com/repos/abogzah559-wq/harbor-frame-generation/releases/latest";
const LAST_BUILD_KEY = "harbor.selfupdate.lastBuild";
const CHECK_EVERY_MS = 3 * 60 * 60 * 1000;

const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type Asset = { name: string; browser_download_url: string; digest?: string | null };
type Release = { tag_name: string; draft?: boolean; prerelease?: boolean; assets?: Asset[] };

export function buildOfTag(tag: string): number {
  const m = /^boost-(\d+)$/.exec(tag.trim());
  return m ? Number(m[1]) : 0;
}

let staged: string | null = null;

async function checkOnce(): Promise<void> {
  if (staged) return;
  const r = await fetch(API, { headers: { Accept: "application/vnd.github+json" } });
  if (!r.ok) return;
  const rel = (await r.json()) as Release;
  if (rel.draft || rel.prerelease) return;
  if (buildOfTag(rel.tag_name) <= HARBOR_BUILD) return;
  const asset = rel.assets?.find((a) => /_x64-setup\.exe$/i.test(a.name));
  if (!asset) return;
  await invoke<string>("selfupdate_stage", {
    url: asset.browser_download_url,
    sha256: asset.digest ?? null,
    tag: rel.tag_name,
  });
  staged = rel.tag_name;
  console.info("[selfupdate] staged", rel.tag_name, "- installs when Harbor closes");
}

let started = false;
export function startSelfUpdate(): void {
  if (started || !IS_TAURI || !/Windows/i.test(navigator.userAgent)) return;
  started = true;
  const run = () => void checkOnce().catch((e) => console.warn("[selfupdate]", e));
  window.setTimeout(run, 20_000);
  window.setInterval(run, CHECK_EVERY_MS);
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
