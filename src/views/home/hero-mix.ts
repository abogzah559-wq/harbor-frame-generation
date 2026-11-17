import { anilistRequest } from "@/lib/anilist/client";
import type { Meta } from "@/lib/cinemeta";
import { tmdbDiscover, tmdbTrending } from "@/lib/providers/tmdb/tmdb-catalogs";
import { effectiveTmdbLanguage, get, IMG } from "@/lib/providers/tmdb/tmdb-client";
import { translateSynopsisToArabic } from "@/lib/subtitles/ai-translate";

/** Only titles first released within this window make the home banner. */
export const HERO_MAX_AGE_DAYS = 730; // 2 years
/** The banner list is rebuilt this often while Harbor stays open. */
export const HERO_REFRESH_MS = 6 * 60 * 60 * 1000;
/** Backdrops narrower than this look soft on the full-width banner. */
const HERO_MIN_WIDTH = 1920;
/** Enough qualified titles of each kind for the banner (it shows 8). */
const HERO_PER_KIND = 6;
const DAY = 24 * 60 * 60 * 1000;

const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Released within the window, and already out. */
export function isRecent(m: Meta, now = Date.now()): boolean {
  const since = now - HERO_MAX_AGE_DAYS * DAY;
  const d = m.releaseDate ? Date.parse(m.releaseDate) : NaN;
  if (Number.isFinite(d)) return d >= since && d <= now;
  const y = parseInt(String(m.releaseInfo ?? "").slice(0, 4), 10);
  if (!Number.isFinite(y)) return false;
  // a bare year: count it when the year overlaps the window
  return y >= new Date(since).getFullYear() && y <= new Date(now).getFullYear();
}

export function looksAnime(m: Meta): boolean {
  return m.originalLanguage === "ja" && !!m.genres?.some((g) => /anim/i.test(g));
}

function shuffle<T>(list: T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function uniq(list: Meta[]): Meta[] {
  const seen = new Set<string>();
  return list.filter((m) => {
    if (!m?.id || seen.has(m.id) || !(m.background || m.poster)) return false;
    seen.add(m.id);
    return true;
  });
}

/** film/series, anime, film/series, anime … (falls back to whichever pool has items left). */
export function interleaveHero(general: Meta[], anime: Meta[], count: number): Meta[] {
  const out: Meta[] = [];
  const seen = new Set<string>();
  let g = 0;
  let a = 0;
  const take = (pool: Meta[], idx: number): [Meta | null, number] => {
    while (idx < pool.length && seen.has(pool[idx].id)) idx++;
    return idx < pool.length ? [pool[idx], idx + 1] : [null, idx];
  };
  while (out.length < count) {
    const wantAnime = out.length % 2 === 1;
    let pick: Meta | null;
    if (wantAnime) {
      [pick, a] = take(anime, a);
      if (!pick) [pick, g] = take(general, g);
    } else {
      [pick, g] = take(general, g);
      if (!pick) [pick, a] = take(anime, a);
    }
    if (!pick) break;
    seen.add(pick.id);
    out.push(pick);
  }
  return out;
}

/** Recent popular films and series plus recent anime from TMDB, each shuffled
 *  (a new order every build). Every title has a sharp, text-free backdrop of
 *  at least 1920 px and a synopsis; titles missing either are left out. */
type HeroMix = { general: Meta[]; anime: Meta[] };
const mixCache = new Map<string, { at: number; p: Promise<HeroMix> }>();

/** Built once and reused (coming back home keeps the same banner) until it
 *  is HERO_REFRESH_MS old; then the next call builds a fresh one. */
export function recentHeroMix(key: string | undefined, withAnime: boolean, geminiKey = ""): Promise<HeroMix> {
  const k = `${key ?? ""}|${withAnime}|${geminiKey ? 1 : 0}`;
  const hit = mixCache.get(k);
  if (hit && Date.now() - hit.at < HERO_REFRESH_MS) return hit.p;
  const p = buildRecentHeroMix(key, withAnime, geminiKey).then((mix) => {
    if (!mix.general.length && !mix.anime.length) mixCache.delete(k); // retry later
    return mix;
  });
  mixCache.set(k, { at: Date.now(), p });
  return p;
}

type RawBackdrop = { file_path: string; width?: number; height?: number; iso_639_1?: string | null; vote_average?: number };

/** Best text-free backdrop at least HERO_MIN_WIDTH wide, at original size. */
async function sharpBackdrop(key: string, kind: "movie" | "tv", id: string): Promise<string | undefined> {
  // text-free backdrops only ("null" = no language)
  const data = await get<{ backdrops?: RawBackdrop[] }>(key, `${kind}/${id}/images`, {
    include_image_language: "null",
  }).catch(() => null);
  const best = (data?.backdrops ?? [])
    .filter((b) => b.file_path && !b.iso_639_1 && (b.width ?? 0) >= HERO_MIN_WIDTH)
    .filter((b) => !b.height || Math.abs((b.width ?? 0) / b.height - 16 / 9) < 0.12)
    .sort((a, b) => (b.vote_average ?? 0) - (a.vote_average ?? 0))[0];
  return best ? `${IMG}/original${best.file_path}` : undefined;
}

const SYNOPSIS_QUERY = `query ($search: String) {
  Media(search: $search, type: ANIME) { description(asHtml: false) startDate { year } }
}`;

function cleanSynopsis(text: string | null | undefined): string {
  return (text ?? "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\(Source:[^)]*\)/gi, "")
    .replace(/\[Written by[^\]]*\]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Synopsis in the app's language; then English; then (anime) AniList.
 *  A foreign-language synopsis is translated to Arabic when a Gemini key is set. */
async function heroSynopsis(
  key: string,
  kind: "movie" | "tv",
  id: string,
  m: Meta,
  anime: boolean,
  geminiKey: string,
): Promise<string | undefined> {
  const lang = effectiveTmdbLanguage() || "en";
  const wantsArabic = lang.toLowerCase().startsWith("ar");
  type EnDetail = { overview?: string; title?: string; name?: string; original_title?: string; original_name?: string };
  const local = await get<EnDetail>(key, `${kind}/${id}`, { language: lang }).catch(() => null);
  const localText = cleanSynopsis(local?.overview);
  if (localText.length >= 40) return localText;
  const en = lang.toLowerCase().startsWith("en")
    ? local
    : await get<EnDetail>(key, `${kind}/${id}`, { language: "en-US" }).catch(() => null);
  let foreign = lang.toLowerCase().startsWith("en") ? "" : cleanSynopsis(en?.overview);
  if (foreign.length < 40 && anime) {
    const titles = [...new Set([en?.title, en?.name, en?.original_title, en?.original_name, m.name])].filter(
      (x): x is string => !!x,
    );
    for (const search of titles) {
      const data = await anilistRequest<{
        Media: { description: string | null; startDate: { year: number | null } | null } | null;
      }>(SYNOPSIS_QUERY, { search }, undefined, true).catch(() => null);
      // a search can land on another show with a similar name: the years must agree
      const year = parseInt(String(m.releaseDate ?? m.releaseInfo ?? "").slice(0, 4), 10);
      const found = data?.Media?.startDate?.year;
      if (Number.isFinite(year) && found && Math.abs(found - year) > 1) continue;
      foreign = cleanSynopsis(data?.Media?.description);
      if (foreign.length >= 40) break;
    }
  }
  if (foreign.length < 40) return localText || undefined;
  if (wantsArabic && geminiKey) {
    const ar = await translateSynopsisToArabic(geminiKey, foreign, m.name);
    if (ar) return ar;
  }
  return foreign;
}

/** Checks titles in order (a few at a time) until `want` pass: each gets its
 *  sharp backdrop and its synopsis written onto the Meta. */
async function qualify(key: string, list: Meta[], want: number, anime: boolean, geminiKey: string): Promise<Meta[]> {
  const out: (Meta | null)[] = new Array(list.length).fill(null);
  let next = 0;
  let passed = 0;
  const worker = async () => {
    while (next < list.length && passed < want) {
      const i = next++;
      const m = list[i];
      const match = m.id.match(/^tmdb:(movie|tv):(\d+)$/);
      if (!match) continue;
      const kind = match[1] as "movie" | "tv";
      const [backdrop, synopsis] = await Promise.all([
        sharpBackdrop(key, kind, match[2]),
        heroSynopsis(key, kind, match[2], m, anime, geminiKey),
      ]);
      if (!backdrop || !synopsis) continue;
      out[i] = { ...m, background: backdrop, description: synopsis };
      passed++;
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  return out.filter((m): m is Meta => !!m);
}

async function buildRecentHeroMix(key: string | undefined, withAnime: boolean, geminiKey: string): Promise<HeroMix> {
  if (!key) return { general: [], anime: [] };
  const since = isoDay(Date.now() - HERO_MAX_AGE_DAYS * DAY);
  const none = () => [] as Meta[];
  const [movies, movies2, tv, tv2, animeTv, animeMovies] = await Promise.all([
    tmdbTrending(key, "movie", "week", 1).catch(none),
    tmdbTrending(key, "movie", "week", 2).catch(none),
    tmdbTrending(key, "tv", "week", 1).catch(none),
    tmdbTrending(key, "tv", "week", 2).catch(none),
    withAnime
      ? tmdbDiscover(key, "tv", {
          with_genres: "16",
          with_original_language: "ja",
          "first_air_date.gte": since,
          "vote_count.gte": "10",
          sort_by: "popularity.desc",
        }).catch(none)
      : Promise.resolve([] as Meta[]),
    withAnime
      ? tmdbDiscover(key, "movie", {
          with_genres: "16",
          with_original_language: "ja",
          "primary_release_date.gte": since,
          "vote_count.gte": "10",
          sort_by: "popularity.desc",
        }).catch(none)
      : Promise.resolve([] as Meta[]),
  ]);
  const general = uniq([...movies, ...movies2, ...tv, ...tv2]).filter(
    (m) => !!m.background && isRecent(m) && !looksAnime(m),
  );
  const anime = uniq([...animeTv, ...animeMovies]).filter((m) => !!m.background && isRecent(m));
  const [g, a] = await Promise.all([
    qualify(key, shuffle(general), HERO_PER_KIND, false, geminiKey),
    qualify(key, shuffle(anime), HERO_PER_KIND, true, geminiKey),
  ]);
  return { general: g, anime: a };
}

/** A random order picked once per launch that stays put while rows keep
 *  loading (a plain shuffle would reorder the banner on every update). */
const LAUNCH_SEED = Math.floor(Math.random() * 0x7fffffff);
function launchRank(id: string): number {
  let h = LAUNCH_SEED ^ 0x9e3779b9;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x85ebca6b) >>> 0;
  return h;
}
export function launchOrder(list: Meta[]): Meta[] {
  return uniq(list).sort((x, y) => launchRank(x.id) - launchRank(y.id));
}
