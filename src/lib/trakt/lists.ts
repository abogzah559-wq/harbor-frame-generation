import { traktRequest } from "./client";
import type { TraktItem } from "./types";

type RawListItem = {
  rank?: number;
  listed_at?: string;
  type: "movie" | "show";
  movie?: { title: string; year: number | null; ids: { imdb?: string; tmdb?: number; trakt?: number } };
  show?: { title: string; year: number | null; ids: { imdb?: string; tmdb?: number; tvdb?: number; trakt?: number } };
};

export async function fetchTraktList(
  listId: string | number,
  page: number = 1,
  limit: number = 20,
  sort?: { by: string; how?: string },
): Promise<TraktItem[]> {
  const plain = () =>
    traktRequest<RawListItem[]>(`/lists/${listId}/items?page=${page}&limit=${limit}`, { authed: false }).catch(
      () => [] as RawListItem[],
    );
  let rows: RawListItem[] = [];
  if (sort?.by) {
    rows = await traktRequest<RawListItem[]>(
      `/lists/${listId}/items/movie,show/${encodeURIComponent(sort.by)}/${sort.how === "desc" ? "desc" : "asc"}?page=${page}&limit=${limit}`,
      { authed: false },
    ).catch(() => [] as RawListItem[]);
    if (!Array.isArray(rows)) rows = [];
  }
  if (!rows.length && (!sort?.by || page === 1)) rows = await plain();

  const out: TraktItem[] = [];
  for (const r of rows) {
    if (r.type === "movie" && r.movie) {
      out.push({
        type: "movie",
        title: r.movie.title,
        year: r.movie.year,
        ids: r.movie.ids,
        contextDate: r.listed_at,
      });
    } else if (r.type === "show" && r.show) {
      out.push({
        type: "show",
        title: r.show.title,
        year: r.show.year,
        ids: r.show.ids,
        contextDate: r.listed_at,
      });
    }
  }
  return out;
}
