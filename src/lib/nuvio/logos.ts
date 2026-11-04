/**
 * Company / network logos for collection tiles, from TMDB (transparent PNG
 * or SVG in the brand's own colours). Looked up once and remembered.
 */
import { useEffect, useState } from "react";
import type { FolderLogo } from "@/lib/custom-sources";
import { get } from "@/lib/providers/tmdb/tmdb-client";

const CACHE_KEY = "harbor.nuvio-logos.v1";
type Entry = { url: string | null; dark?: boolean };

const mem: Record<string, Entry> = (() => {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}");
  } catch {
    return {};
  }
})();
let flush = 0;
function remember(k: string, e: Entry) {
  mem[k] = e;
  window.clearTimeout(flush);
  flush = window.setTimeout(() => {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(mem));
    } catch {
      /* ignore */
    }
  }, 500);
}

const inflight = new Map<string, Promise<Entry>>();

export function logoKey(l: FolderLogo): string {
  return l.kind === "company-search" ? `q:${l.query.toLowerCase()}` : `${l.kind}:${l.id}`;
}

type Img = { logo_path?: string | null; name?: string };

async function lookup(key: string, l: FolderLogo): Promise<string | null> {
  let path: string | null | undefined = null;
  if (l.kind !== "company-search") path = (await get<Img>(key, `${l.kind}/${l.id}`))?.logo_path;
  else {
    const res = await get<{ results?: Img[] }>(key, "search/company", { query: l.query });
    const list = res?.results ?? [];
    const q = l.query.toLowerCase();
    const hit =
      list.find((r) => r.logo_path && r.name?.toLowerCase() === q) ?? list.find((r) => r.logo_path);
    path = hit?.logo_path;
  }
  return path ? `https://image.tmdb.org/t/p/w500${path}` : null;
}

/** Black / very dark logos vanish on Harbor's dark tiles: those get shown white. */
function measureDark(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = 48;
        c.height = 24;
        const ctx = c.getContext("2d");
        if (!ctx) return resolve(false);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        let sum = 0;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] < 60) continue;
          sum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
          n++;
        }
        resolve(n > 0 && sum / n < 0.3);
      } catch {
        resolve(false);
      }
    };
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

export function resolveLogo(tmdbKey: string | undefined, l: FolderLogo): Promise<Entry> {
  const k = logoKey(l);
  if (mem[k]) return Promise.resolve(mem[k]);
  if (!tmdbKey) return Promise.resolve({ url: null });
  let p = inflight.get(k);
  if (!p) {
    p = (async () => {
      const url = await lookup(tmdbKey, l).catch(() => null);
      const entry: Entry = { url, dark: url ? await measureDark(url) : false };
      remember(k, entry);
      return entry;
    })();
    inflight.set(k, p);
  }
  return p;
}

export function useFolderLogo(tmdbKey: string | undefined, l: FolderLogo | undefined, active = true): Entry | null {
  const [entry, setEntry] = useState<Entry | null>(() => (l ? (mem[logoKey(l)] ?? null) : null));
  useEffect(() => {
    if (!l || !active) return;
    let cancelled = false;
    void resolveLogo(tmdbKey, l).then((e) => {
      if (!cancelled) setEntry(e);
    });
    return () => {
      cancelled = true;
    };
  }, [tmdbKey, l, active]);
  return entry;
}

/* ---- backdrop of the network's / studio's best-known title ---- */

const BG_KEY = "harbor.nuvio-logo-bg.v1";
const bgMem: Record<string, string | null> = (() => {
  try {
    return JSON.parse(localStorage.getItem(BG_KEY) ?? "{}");
  } catch {
    return {};
  }
})();
let bgFlush = 0;
const bgInflight = new Map<string, Promise<string | null>>();

/** Picks the first title with a backdrop from the folder's "popular" catalog. */
export function useFolderBackdrop(
  key: string,
  load: () => Promise<{ background?: string }[]>,
  active: boolean,
): string | null {
  const [bg, setBg] = useState<string | null>(() => bgMem[key] ?? null);
  useEffect(() => {
    if (!active || key in bgMem) return;
    let cancelled = false;
    let p = bgInflight.get(key);
    if (!p) {
      p = load()
        .then((list) => list.find((m) => m.background)?.background ?? null)
        .catch(() => null)
        .then((url) => {
          bgMem[key] = url;
          window.clearTimeout(bgFlush);
          bgFlush = window.setTimeout(() => {
            try {
              localStorage.setItem(BG_KEY, JSON.stringify(bgMem));
            } catch {
              /* ignore */
            }
          }, 500);
          return url;
        });
      bgInflight.set(key, p);
    }
    void p.then((url) => {
      if (!cancelled) setBg(url);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, active]);
  return bg;
}
