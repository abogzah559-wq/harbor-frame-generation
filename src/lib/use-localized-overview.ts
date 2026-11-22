import { useEffect, useState } from "react";
import type { Meta } from "@/lib/cinemeta";
import { tmdbMetadataOverview } from "@/lib/providers/tmdb/tmdb-lite";
import { useSettings } from "@/lib/settings";
import { hasArabic, useArabicMeta } from "@/lib/arabic-meta";

export function useLocalizedOverview(meta: Meta): string | undefined {
  const { settings } = useSettings();
  const arabic = useArabicMeta(meta, true);
  const isTmdb = meta.id.startsWith("tmdb:");
  // Start from the text the item already carries, so a synopsis never pops
  // in late; swap in the localized one only when it differs.
  const [overview, setOverview] = useState<string | undefined>(meta.description || undefined);
  useEffect(() => {
    if (!isTmdb || !settings.tmdbKey) {
      setOverview(meta.description);
      return;
    }
    setOverview(meta.description || undefined);
    let alive = true;
    void tmdbMetadataOverview(settings.tmdbKey, meta.id).then((o) => {
      if (alive) setOverview(o ?? meta.description);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta.id, settings.tmdbKey]);
  if (hasArabic(overview)) return overview;
  return hasArabic(arabic.description) ? arabic.description : overview;
}
