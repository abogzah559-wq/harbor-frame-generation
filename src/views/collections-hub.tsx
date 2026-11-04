import { ArrowLeft, Layers } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { BackToTop } from "@/components/back-to-top";
import { CollectionsRow } from "@/components/collections-row";
import { CustomSourcesRow } from "@/components/custom-sources-row";
import { SourceFolderCard } from "@/components/source-folder-card";
import type { SourceRow } from "@/lib/custom-sources";
import { useT } from "@/lib/i18n";
import { loadNuvioPresets, NUVIO_ANIME_PREFIX } from "@/lib/nuvio/presets";
import { useSettings } from "@/lib/settings";
import { useScrollMemory } from "@/lib/view";

/** "Collections" in the side menu: every collection, one row each, no repeats. */
export function CollectionsHub() {
  const t = useT();
  const { settings } = useSettings();
  const scrollRef = useRef<HTMLElement>(null);
  useScrollMemory("hub", scrollRef);
  const [presets, setPresets] = useState<SourceRow[]>([]);
  const [open, setOpen] = useState<SourceRow | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadNuvioPresets().then((r) => !cancelled && setPresets(r));
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo(() => {
    const own = settings.homeRows.customSources ?? [];
    const titles = new Set(presets.map((p) => p.title.trim().toLowerCase()));
    const extra = own.filter((sr) => !titles.has(sr.title.trim().toLowerCase()));
    return [...presets, ...extra].filter(
      (sr) => !(settings.hideContent.anime && sr.id.startsWith(NUVIO_ANIME_PREFIX)),
    );
  }, [presets, settings.homeRows.customSources, settings.hideContent.anime]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [open]);

  return (
    <main ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden px-5 pb-20 pt-24 sm:px-8 lg:px-12 lg:pt-28">
      {open ? (
        <div className="flex flex-col gap-8">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setOpen(null)}
              aria-label={t("Back")}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-elevated text-ink-muted transition-colors hover:text-ink"
            >
              <ArrowLeft size={18} strokeWidth={2.2} className="dir-icon" />
            </button>
            <h1 className="font-display text-[32px] font-bold leading-none text-ink">{open.title}</h1>
            <span className="text-[14px] text-ink-subtle">{open.folders.length}</span>
          </div>
          <div
            className={`grid gap-5 ${
              open.folders[0]?.tileShape === "POSTER" && !open.folders[0]?.logo
                ? "grid-cols-[repeat(auto-fill,minmax(180px,1fr))]"
                : "grid-cols-[repeat(auto-fill,minmax(300px,1fr))]"
            }`}
          >
            {open.folders.map((f, i) => (
              <SourceFolderCard key={`${f.id}-${i}`} folder={f} sourceId={open.id} />
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-12">
          <div className="flex items-center gap-3">
            <Layers size={28} strokeWidth={2.2} className="text-accent" />
            <h1 className="font-display text-[36px] font-bold leading-none text-ink">{t("nav.hub")}</h1>
          </div>
          {settings.tmdbKey && <CollectionsRow />}
          {rows.map((sr) => (
            <CustomSourcesRow key={sr.id} sourceRow={sr} onViewAll={() => setOpen(sr)} />
          ))}
          {rows.length === 0 && (
            <div className="flex gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="aspect-[16/9] w-[320px] animate-pulse rounded-2xl bg-elevated/60" />
              ))}
            </div>
          )}
        </div>
      )}
      <BackToTop scrollRef={scrollRef} />
    </main>
  );
}
