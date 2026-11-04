/**
 * Turns a Nuvio-style collection folder into a page Harbor can show: one tab
 * per source (TMDB discover / company / collection / list, Trakt lists,
 * MyAnimeList via Jikan, or a Stremio addon catalog).
 */
import type { Meta } from "@/lib/cinemeta";
import { createAddonCatalogFetcher, gatherCatalogAddons } from "@/lib/addons";
import type { NativeSource, SourceFolder } from "@/lib/custom-sources";
import { resolveMdblist } from "@/lib/lists/sources/mdblist";
import { jikanQuery } from "@/lib/providers/jikan";
import { tmdbCollection, tmdbDiscover } from "@/lib/providers/tmdb";
import { get } from "@/lib/providers/tmdb/tmdb-client";
import { movieMeta, seriesMeta, type RawMovie, type RawSeries } from "@/lib/providers/tmdb/tmdb-meta-mappers";
import { hydrateTraktItems } from "@/lib/trakt/hydrate";
import { fetchTraktList } from "@/lib/trakt/lists";
import type { GridSpec, GridTab } from "@/lib/view";

export type FolderGridError = { error: "tmdb-key" } | { error: "mdblist-key" } | { error: "addon"; addonId: string } | { error: "empty" };

type Ctx = { tmdbKey?: string; mdblistKey?: string; authKey?: string | null };

const PAGE = 20;

/** Nuvio filter names → TMDB discover query (null / empty values dropped). */
export function tmdbDiscoverParams(source: NativeSource): Record<string, string> {
  const tv = source.mediaType === "TV";
  const params: Record<string, string> = {};
  let sort = source.sortBy || "popularity.desc";
  if (tv) sort = sort.replace("primary_release_date", "first_air_date");
  else sort = sort.replace("first_air_date", "primary_release_date");
  if (!/\.(asc|desc)$/.test(sort)) sort = "popularity.desc";
  params.sort_by = sort;
  for (const [k, raw] of Object.entries(source.filters ?? {})) {
    if (raw == null || raw === "") continue;
    const v = String(raw);
    switch (k) {
      case "year":
        params[tv ? "first_air_date_year" : "primary_release_year"] = v;
        break;
      case "releaseDateGte":
        params[tv ? "first_air_date.gte" : "primary_release_date.gte"] = v;
        break;
      case "releaseDateLte":
        params[tv ? "first_air_date.lte" : "primary_release_date.lte"] = v;
        break;
      case "voteCountGte":
        params["vote_count.gte"] = v;
        break;
      case "voteAverageGte":
        params["vote_average.gte"] = v;
        break;
      case "voteAverageLte":
        params["vote_average.lte"] = v;
        break;
      case "withNetworks":
        if (tv) params.with_networks = v;
        break;
      default:
        params[k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)] = v;
    }
  }
  if (source.tmdbSourceType === "COMPANY" && source.tmdbId != null) params.with_companies = String(source.tmdbId);
  // date-sorted lists put unreleased titles first; keep them out
  if (/date\.desc$/.test(sort)) {
    const today = new Date().toISOString().slice(0, 10);
    const key = tv ? "first_air_date.lte" : "primary_release_date.lte";
    if (!params[key] || params[key] > today) params[key] = today;
  }
  return params;
}

type RawListItem = (RawMovie & { media_type?: string }) | (RawSeries & { media_type?: string });

/** TMDB v3 list: fetched whole once (lists are short), sorted, then paged. */
function tmdbListFetcher(key: string, source: NativeSource): (page: number) => Promise<Meta[]> {
  let all: Promise<Meta[]> | null = null;
  const load = async () => {
    const out: Meta[] = [];
    for (let page = 1; page <= 10; page++) {
      const data = await get<{ items?: RawListItem[]; total_pages?: number }>(key, `list/${source.tmdbId}`, {
        page: String(page),
      });
      for (const it of data?.items ?? []) {
        if (it.media_type === "tv" || ("name" in it && !("title" in it))) out.push(seriesMeta(it as RawSeries));
        else out.push(movieMeta(it as RawMovie));
      }
      if (!data || page >= (data.total_pages ?? 1)) break;
    }
    const sort = source.sortBy ?? "original";
    const num = (s?: string) => (s ? Date.parse(s) || 0 : 0);
    if (sort.startsWith("primary_release_date") || sort.startsWith("first_air_date") || sort === "released")
      out.sort((a, b) => num(b.releaseDate) - num(a.releaseDate));
    else if (sort.startsWith("vote_average")) out.sort((a, b) => Number(b.imdbRating ?? 0) - Number(a.imdbRating ?? 0));
    // "original" / "popularity": keep the curator's order
    if (sort.endsWith(".asc")) out.reverse();
    return out.filter((m) => !!m.poster);
  };
  return async (page) => {
    all ??= load();
    const list = await all;
    return list.slice((page - 1) * PAGE, page * PAGE);
  };
}

function nativeTab(source: NativeSource, folder: SourceFolder, ctx: Ctx): GridTab | "tmdb-key" | "mdblist-key" | null {
  const title = source.title || folder.title;
  if (source.provider === "mdblist" && source.listId) {
    if (!ctx.mdblistKey) return "mdblist-key";
    const key = ctx.mdblistKey;
    let all: Promise<Meta[]> | null = null;
    return {
      title,
      fetcher: async (page) => {
        all ??= resolveMdblist(source.listId!, key);
        return (await all).slice((page - 1) * PAGE, page * PAGE);
      },
    };
  }
  if (source.provider === "jikan" && source.path) {
    const params = source.params ?? {};
    return { title, fetcher: (page) => jikanQuery(source.path!, { ...params, page }) };
  }
  if (source.provider === "tmdb") {
    if (!ctx.tmdbKey) return "tmdb-key";
    const key = ctx.tmdbKey;
    const kind = source.mediaType === "TV" ? "tv" : "movie";
    switch (source.tmdbSourceType) {
      case "DISCOVER":
      case "COMPANY": {
        const params = tmdbDiscoverParams(source);
        return { title, fetcher: (page) => tmdbDiscover(key, kind, { ...params, page: String(page) }) };
      }
      case "COLLECTION":
        if (source.tmdbId == null) return null;
        return {
          title,
          fetcher: async (page) => {
            if (page > 1) return [];
            const coll = await tmdbCollection(key, Number(source.tmdbId));
            return coll?.parts ?? [];
          },
        };
      case "LIST":
        if (source.tmdbId == null) return null;
        return { title, fetcher: tmdbListFetcher(key, source) };
      default:
        return null;
    }
  }
  if (source.provider === "trakt" && source.traktListId != null) {
    if (!ctx.tmdbKey) return "tmdb-key";
    const key = ctx.tmdbKey;
    const sort = source.sortBy ? { by: source.sortBy, how: source.sortHow ?? "asc" } : undefined;
    return {
      title,
      fetcher: async (page) => hydrateTraktItems(await fetchTraktList(source.traktListId!, page, PAGE, sort), key),
    };
  }
  return null;
}

export async function buildFolderGrid(
  folder: SourceFolder,
  ctx: Ctx,
): Promise<GridSpec | FolderGridError> {
  const tabs: GridTab[] = [];
  let needKey = false;
  let needMdblist = false;
  let missingAddon: string | undefined;
  for (const s of folder.sources ?? []) {
    const tab = nativeTab(s, folder, ctx);
    if (tab === "tmdb-key") needKey = true;
    else if (tab === "mdblist-key") needMdblist = true;
    else if (tab) tabs.push(tab);
  }
  if (folder.catalogSources?.length) {
    const addons = await gatherCatalogAddons(ctx.authKey ?? null).catch(() => []);
    for (const src of folder.catalogSources) {
      const addon = addons.find((a) => a.manifest.id === src.addonId);
      if (!addon) {
        missingAddon ??= src.addonId;
        continue;
      }
      tabs.push({
        title: folder.title,
        fetcher: createAddonCatalogFetcher({
          base: addon.transportUrl.replace(/\/manifest\.json$/, ""),
          type: src.type,
          id: src.catalogId,
        }),
      });
    }
  }
  if (!tabs.length) {
    if (missingAddon) return { error: "addon", addonId: missingAddon };
    if (needMdblist) return { error: "mdblist-key" };
    return needKey ? { error: "tmdb-key" } : { error: "empty" };
  }
  // tabs with the same name (e.g. "Most Watched" movies + series) get numbered
  const seen = new Map<string, number>();
  for (const t of tabs) {
    const n = (seen.get(t.title) ?? 0) + 1;
    seen.set(t.title, n);
    if (n > 1) t.title = `${t.title} ${n}`;
  }
  const list = tabs;
  return {
    title: folder.title,
    fetcher: list[0].fetcher,
    tabs: list.length > 1 ? list : undefined,
    backdrop: folder.heroBackdropUrl ?? undefined,
    logo: folder.titleLogoUrl ?? undefined,
    folderLogo: folder.logo,
  };
}
