import type { SourceRow } from "@/lib/custom-sources";

/** Built-in collections (from the user's Nuvio profiles), shipped as a static
 *  file so they are always there without being copied into settings. */
export const NUVIO_ANIME_PREFIX = "nuvio-anime";

let cached: Promise<SourceRow[]> | null = null;

export function loadNuvioPresets(): Promise<SourceRow[]> {
  cached ??= fetch("/nuvio/presets.json")
    .then((r) => (r.ok ? (r.json() as Promise<SourceRow[]>) : []))
    .then((rows) => (Array.isArray(rows) ? rows.filter((r) => r?.folders?.length) : []))
    .catch(() => {
      cached = null;
      return [] as SourceRow[];
    });
  return cached;
}
