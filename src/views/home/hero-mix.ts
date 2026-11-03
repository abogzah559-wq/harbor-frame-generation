import type { Meta } from "@/lib/cinemeta";
import { tmdbDiscover, tmdbTrending } from "@/lib/providers/tmdb/tmdb-catalogs";

/** Only titles first released within this window make the home banner. */
export const HERO_MAX_AGE_DAYS = 540; // ~1.5 years
const DAY = 24 * 60 * 60 * 1000;

const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Released within the window (and not years in the future). */
export function isRecent(m: Meta, now = Date.now()): boolean {
  const since = now - HERO_MAX_AGE_DAYS * DAY;
  const d = m.releaseDate ? Date.parse(m.releaseDate) : NaN;
  if (Number.isFinite(d)) return d >= since && d <= now + 60 * DAY;
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
 *  (a new order every launch), with wide backdrops for the banner. */
type HeroMix = { general: Meta[]; anime: Meta[] };
const mixCache = new Map<string, Promise<HeroMix>>();

/** Once per launch: coming back to the home page keeps the same banner order. */
export function recentHeroMix(key: string | undefined, withAnime: boolean): Promise<HeroMix> {
  const k = `${key ?? ""}|${withAnime}`;
  let p = mixCache.get(k);
  if (!p) {
    p = buildRecentHeroMix(key, withAnime).then((mix) => {
      if (!mix.general.length && !mix.anime.length) mixCache.delete(k); // retry later
      return mix;
    });
    mixCache.set(k, p);
  }
  return p;
}

async function buildRecentHeroMix(key: string | undefined, withAnime: boolean): Promise<HeroMix> {
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
  return { general: shuffle(general), anime: shuffle(anime) };
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
