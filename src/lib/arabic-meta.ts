/**
 * Arabic names and stories for every title, wherever it came from.
 *
 * TMDB rows already arrive in Arabic, but addon rows (Cinemeta and friends),
 * anime rows (Jikan / AniList / Kitsu) and search hits arrive in English.
 * Cards call useArabicMeta(meta): it returns the Arabic version from a cache
 * on disk right away, and fills misses in the background:
 *
 *   1. TMDB in Arabic (needs the user's own TMDB key): official Arabic title
 *      and overview, found by tmdb id, IMDb id, or the anime's IMDb mapping.
 *   2. Free Google Translate for whatever is still English (works for anyone,
 *      no key), so even without a key the story is readable in Arabic.
 *
 * Results are kept for 30 days, so each title is looked up once.
 */
import { useEffect, useState } from "react";
import type { Meta } from "@/lib/cinemeta";
import { get as tmdbGet } from "@/lib/providers/tmdb/tmdb-client";
import { externalToKitsu, kitsuToImdb } from "@/lib/providers/anime-mapping";
import { safeFetch } from "@/lib/safe-fetch";

type Entry = { n?: string; d?: string; at: number };

const STORE_KEY = "harbor.ar-meta.v1";
const MAX_ENTRIES = 4000;
const TTL_MS = 30 * 24 * 3600 * 1000;
const MAX_PARALLEL = 4;

const ARABIC_RX = /[؀-ۿ]/;

export function hasArabic(text: string | undefined | null): boolean {
  return !!text && ARABIC_RX.test(text);
}

let cache: Map<string, Entry> | null = null;
let saveTimer = 0;
const listeners = new Map<string, Set<() => void>>();
const inflight = new Map<string, Promise<void>>();
const queue: Array<() => Promise<void>> = [];
let running = 0;
let tmdbKey = "";

export function setArabicMetaKey(key: string): void {
  tmdbKey = key.trim();
}

function load(): Map<string, Entry> {
  if (cache) return cache;
  cache = new Map();
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const obj = JSON.parse(raw) as Record<string, Entry>;
      const now = Date.now();
      for (const [k, v] of Object.entries(obj)) {
        if (v && typeof v.at === "number" && now - v.at < TTL_MS) cache.set(k, v);
      }
    }
  } catch {
    /* start empty */
  }
  return cache;
}

function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = window.setTimeout(() => {
    saveTimer = 0;
    const c = load();
    // Keep the newest entries only.
    const entries = [...c.entries()].sort((a, b) => b[1].at - a[1].at).slice(0, MAX_ENTRIES);
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(entries)));
    } catch {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(entries.slice(0, 1000))));
      } catch {
        /* storage full; the in-memory cache still works this session */
      }
    }
  }, 1500);
}

function notify(key: string): void {
  const set = listeners.get(key);
  if (set) for (const l of set) l();
}

function pump(): void {
  while (running < MAX_PARALLEL && queue.length > 0) {
    const job = queue.shift()!;
    running++;
    void job().finally(() => {
      running--;
      pump();
    });
  }
}

/** Free Google Translate (no key). Returns null when it can't be reached. */
export async function googleTranslateToArabic(text: string): Promise<string | null> {
  return googleTranslate(text, "ar");
}

export async function googleTranslate(text: string, target: "ar" | "en"): Promise<string | null> {
  const q = text.trim();
  if (!q) return null;
  try {
    const url =
      `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${target}&dt=t&q=` +
      encodeURIComponent(q.slice(0, 4500));
    const res = await safeFetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as unknown;
    if (!Array.isArray(data) || !Array.isArray(data[0])) return null;
    const out = (data[0] as unknown[])
      .map((part) => (Array.isArray(part) && typeof part[0] === "string" ? part[0] : ""))
      .join("")
      .trim();
    return out || null;
  } catch {
    return null;
  }
}

type TmdbHit = { title?: string; name?: string; overview?: string };

async function tmdbArabic(meta: Meta): Promise<{ n?: string; d?: string } | null> {
  if (!tmdbKey) return null;
  const lang = { language: "ar-SA" };
  const id = meta.id;
  const tm = id.match(/^tmdb:(\d+)/);
  if (tm) {
    const path = meta.type === "series" ? `tv/${tm[1]}` : `movie/${tm[1]}`;
    const r = await tmdbGet<TmdbHit>(tmdbKey, path, lang).catch(() => null);
    return r ? { n: r.title ?? r.name, d: r.overview } : null;
  }
  let imdb: string | null = id.match(/^(tt\d+)/)?.[1] ?? null;
  if (!imdb) {
    const anime = id.match(/^(kitsu|mal|anilist|anidb):(\d+)/);
    if (anime) {
      const kitsu =
        anime[1] === "kitsu" ? Number(anime[2]) : await externalToKitsu(anime[1] === "mal" ? "myanimelist" : anime[1], Number(anime[2])).catch(() => null);
      if (kitsu) imdb = await kitsuToImdb(kitsu).catch(() => null);
    }
  }
  if (!imdb) return null;
  const found = await tmdbGet<{ movie_results?: TmdbHit[]; tv_results?: TmdbHit[] }>(
    tmdbKey,
    `find/${imdb}`,
    { external_source: "imdb_id", ...lang },
  ).catch(() => null);
  const hit =
    meta.type === "series"
      ? found?.tv_results?.[0] ?? found?.movie_results?.[0]
      : found?.movie_results?.[0] ?? found?.tv_results?.[0];
  return hit ? { n: hit.title ?? hit.name, d: hit.overview } : null;
}

function cacheId(meta: Meta): string {
  return `${meta.type}:${meta.id}`;
}

function resolve(meta: Meta): Promise<void> {
  const key = cacheId(meta);
  const pending = inflight.get(key);
  if (pending) return pending;
  const p = new Promise<void>((done) => {
    queue.push(async () => {
      try {
        const entry: Entry = { at: Date.now() };
        const fromTmdb = await tmdbArabic(meta).catch(() => null);
        if (hasArabic(fromTmdb?.n)) entry.n = fromTmdb!.n!.trim();
        if (hasArabic(fromTmdb?.d)) entry.d = fromTmdb!.d!.trim();
        let unreachable = false;
        if (!entry.n && meta.name && !hasArabic(meta.name)) {
          const n = await googleTranslateToArabic(meta.name);
          if (hasArabic(n)) entry.n = n!;
          else if (n == null) unreachable = true;
        }
        if (!entry.d && meta.description && !hasArabic(meta.description)) {
          const d = await googleTranslateToArabic(meta.description);
          if (hasArabic(d)) entry.d = d!;
          else if (d == null) unreachable = true;
        }
        // Translation service busy or offline: remember the gap for ten
        // minutes only, then try again, instead of keeping English for a month.
        if (unreachable && !(entry.n && entry.d)) entry.at = Date.now() - TTL_MS + 10 * 60 * 1000;
        load().set(key, entry);
        scheduleSave();
        notify(key);
      } finally {
        inflight.delete(key);
        done();
      }
    });
    pump();
  });
  inflight.set(key, p);
  return p;
}

function needsWork(meta: Meta): boolean {
  if (!meta?.id || !meta.name) return false;
  const nameDone = hasArabic(meta.name);
  const descDone = !meta.description || hasArabic(meta.description);
  return !(nameDone && descDone);
}

/** The Arabic version of a meta from the cache, or the meta itself. */
export function arabicMetaNow(meta: Meta): Meta {
  if (!needsWork(meta)) return meta;
  const e = load().get(cacheId(meta));
  if (!e) return meta;
  if (Date.now() - e.at >= TTL_MS) {
    load().delete(cacheId(meta));
    return meta;
  }
  const name = !hasArabic(meta.name) && e.n ? e.n : meta.name;
  const description = meta.description && !hasArabic(meta.description) && e.d ? e.d : meta.description ?? e.d;
  if (name === meta.name && description === meta.description) return meta;
  return { ...meta, name, description };
}

/** Arabic text for a story shown on its own (detail pages, hero). */
export async function arabicOverview(meta: Meta): Promise<string | undefined> {
  if (!needsWork(meta)) return meta.description;
  if (!load().has(cacheId(meta))) await resolve(meta);
  return arabicMetaNow(meta).description;
}

export function useArabicMeta<T extends Meta | null | undefined>(meta: T): T {
  const [, bump] = useState(0);
  const id = meta ? cacheId(meta) : "";
  useEffect(() => {
    if (!meta || !needsWork(meta)) return;
    const onChange = () => bump((n) => n + 1);
    let set = listeners.get(id);
    if (!set) {
      set = new Set();
      listeners.set(id, set);
    }
    set.add(onChange);
    if (!load().has(id)) void resolve(meta);
    return () => {
      const s = listeners.get(id);
      s?.delete(onChange);
      if (s && s.size === 0) listeners.delete(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  if (!meta) return meta;
  return arabicMetaNow(meta) as T;
}
