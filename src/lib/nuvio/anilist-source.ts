/**
 * Anime catalogs for the collections, from AniList (graphql.anilist.co).
 * The Nuvio profile used MyAnimeList catalogs; Jikan (the MAL API) isn't
 * reachable from every network, AniList is and has the same data (studio
 * ids even match MAL's).
 */
import type { Meta } from "@/lib/cinemeta";
import { anilistRequest } from "@/lib/anilist/client";
import { anilistMediaToMeta } from "@/lib/anilist/to-meta";
import type { AnilistMedia } from "@/lib/anilist/types";

export type AnilistParams = {
  sort?: string;
  status?: string;
  format?: string;
  season?: string;
  seasonYear?: number;
  genre?: string;
  tag?: string;
  startGreater?: number;
  startLesser?: number;
  studio?: number;
};

const FIELDS = `id idMal title { romaji english native userPreferred } coverImage { extraLarge large medium } bannerImage format episodes averageScore seasonYear`;

const MEDIA_QUERY = `query ($page: Int, $perPage: Int, $sort: [MediaSort], $status: MediaStatus, $format: MediaFormat, $season: MediaSeason, $seasonYear: Int, $genre: String, $tag: String, $startGreater: FuzzyDateInt, $startLesser: FuzzyDateInt) {
  Page(page: $page, perPage: $perPage) {
    media(type: ANIME, isAdult: false, sort: $sort, status: $status, format: $format, season: $season, seasonYear: $seasonYear, genre: $genre, tag: $tag, startDate_greater: $startGreater, startDate_lesser: $startLesser) { ${FIELDS} }
  }
}`;

const STUDIO_QUERY = `query ($id: Int, $page: Int, $perPage: Int) {
  Studio(id: $id) {
    media(page: $page, perPage: $perPage, sort: POPULARITY_DESC, isMain: true) { nodes { ${FIELDS} } }
  }
}`;

const PER_PAGE = 30;

function toMetas(list: AnilistMedia[] | undefined): Meta[] {
  const out: Meta[] = [];
  const seen = new Set<string>();
  for (const m of list ?? []) {
    const meta = anilistMediaToMeta(m);
    if (!meta || seen.has(meta.id)) continue;
    seen.add(meta.id);
    out.push(meta);
  }
  return out;
}

export async function anilistCatalog(p: AnilistParams, page: number): Promise<Meta[]> {
  if (p.studio) {
    const data = await anilistRequest<{ Studio: { media: { nodes: AnilistMedia[] } } | null }>(
      STUDIO_QUERY,
      { id: p.studio, page, perPage: PER_PAGE },
      undefined,
      true,
    );
    return toMetas(data?.Studio?.media?.nodes);
  }
  const data = await anilistRequest<{ Page: { media: AnilistMedia[] } | null }>(
    MEDIA_QUERY,
    {
      page,
      perPage: PER_PAGE,
      sort: [p.sort ?? "POPULARITY_DESC"],
      status: p.status,
      format: p.format,
      season: p.season,
      seasonYear: p.seasonYear,
      genre: p.genre,
      tag: p.tag,
      startGreater: p.startGreater,
      startLesser: p.startLesser,
    },
    undefined,
    true,
  );
  return toMetas(data?.Page?.media);
}
