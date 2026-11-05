import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { BackToTop } from "@/components/back-to-top";
import { PickCard } from "@/components/pick-card";
import { Row } from "@/components/row";
import { useFolderLogo } from "@/lib/nuvio/logos";
import { useSettings } from "@/lib/settings";
import type { Meta } from "@/lib/cinemeta";
import { useT } from "@/lib/i18n";
import { layoutHasGlobalBack } from "@/lib/theme";
import { useScrollMemory, useView, type GridSpec } from "@/lib/view";

const PAGE_CAP = 40;

export function GridView({ grid }: { grid: GridSpec }) {
  if (grid.tabs?.length) return <FolderRowsView grid={grid} />;
  return <GridPane grid={grid} />;
}

/** A collection folder with several catalogs: a header, then one Harbor row
 *  per catalog. Rows load only when you scroll near them. */
function FolderRowsView({ grid }: { grid: GridSpec }) {
  const { goBack, openGrid } = useView();
  const t = useT();
  const scrollRef = useRef<HTMLElement>(null);
  useScrollMemory(`folder:${grid.title}`, scrollRef);
  return (
    <main ref={scrollRef} className="absolute inset-0 z-30 overflow-y-auto bg-canvas">
      <FolderHeader grid={grid} onBack={goBack} />
      <div className="flex w-full flex-col gap-10 px-12 pb-24 pt-2">
        {grid.tabs!.map((tab, i) => (
          <LazyFolderRow
            key={`${tab.title}-${i}`}
            title={tab.title}
            fetcher={tab.fetcher}
            eager={i < 2}
            onViewAll={(initial) => openGrid({ title: `${grid.title} · ${tab.title}`, fetcher: tab.fetcher, initial })}
            emptyLabel={t("Nothing here yet.")}
          />
        ))}
      </div>
      <BackToTop scrollRef={scrollRef} />
    </main>
  );
}

function FolderHeader({ grid, onBack }: { grid: GridSpec; onBack: () => void }) {
  const { settings } = useSettings();
  const logoEntry = useFolderLogo(settings.tmdbKey, grid.logo ? undefined : grid.folderLogo);
  const logo = grid.logo ?? logoEntry?.url ?? undefined;
  return (
    <section className={`relative w-full overflow-hidden ${grid.backdrop ? "h-[46vh] min-h-[340px]" : "h-[300px]"}`}>
      {grid.backdrop ? (
        <img src={grid.backdrop} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-white/[0.06] via-transparent to-transparent" />
      )}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-canvas via-canvas/40 to-transparent" />
      {!layoutHasGlobalBack() && (
        <button
          onClick={onBack}
          aria-label="Back"
          className="absolute start-12 top-24 flex h-10 w-10 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-md transition-colors hover:bg-black/65"
        >
          <ArrowLeft size={18} strokeWidth={2.2} className="dir-icon" />
        </button>
      )}
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-start gap-3 px-12 pb-6">
        {logo ? (
          <img
            src={logo}
            alt={grid.title}
            draggable={false}
            className="max-h-[110px] max-w-[min(480px,55%)] object-contain drop-shadow-[0_6px_24px_rgba(0,0,0,0.65)]"
            style={!grid.logo && logoEntry?.dark ? { filter: "brightness(0) invert(1)" } : undefined}
          />
        ) : (
          <h1 className="font-display text-[clamp(34px,4.6vw,58px)] font-bold leading-tight text-white drop-shadow-[0_4px_18px_rgba(0,0,0,0.7)]">
            {grid.title}
          </h1>
        )}
      </div>
    </section>
  );
}

function LazyFolderRow({
  title,
  fetcher,
  eager,
  onViewAll,
  emptyLabel,
}: {
  title: string;
  fetcher: (page: number) => Promise<Meta[]>;
  eager: boolean;
  onViewAll: (initial: Meta[]) => void;
  emptyLabel: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(eager);
  const [metas, setMetas] = useState<Meta[] | null>(null);
  const [page, setPage] = useState(0);
  const [more, setMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    if (near) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && setNear(true), {
      rootMargin: "600px 0px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);

  const load = (next: number) => {
    if (busy.current) return;
    busy.current = true;
    fetcher(next)
      .then((batch) => {
        setPage(next);
        setMetas((prev) => {
          const seen = new Set((prev ?? []).map((m) => m.id));
          const fresh = batch.filter((m) => m?.id && !seen.has(m.id));
          if (!fresh.length) setMore(false);
          return [...(prev ?? []), ...fresh];
        });
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
        setMetas((prev) => prev ?? []);
        setMore(false);
      })
      .finally(() => {
        busy.current = false;
      });
  };

  useEffect(() => {
    if (near && page === 0) load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [near]);

  // a catalog that turned out empty is left out instead of showing a blank row
  if (metas && metas.length === 0 && !error) return null;

  return (
    <div ref={ref} className="min-h-[300px]">
      {metas === null ? (
        <div className="flex flex-col gap-4">
          <h2 className="font-display text-[22px] font-semibold text-ink">{title}</h2>
          <div className="flex gap-4 overflow-hidden">
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="aspect-[2/3] w-[170px] shrink-0 animate-pulse rounded-xl bg-elevated/60" />
            ))}
          </div>
        </div>
      ) : metas.length === 0 ? (
        <p className="text-[13px] text-ink-subtle">
          {title}: {emptyLabel} {error ? `(${error})` : ""}
        </p>
      ) : (
        <Row
          title={title}
          min={170}
          arrowsAlways
          onEndReached={more ? () => load(page + 1) : undefined}
          onViewAll={() => onViewAll(metas)}
        >
          {metas.map((m, i) => (
            <PickCard key={`${m.id}-${i}`} meta={m} />
          ))}
        </Row>
      )}
    </div>
  );
}

function GridPane({ grid, scrollKey, tabBar }: { grid: GridSpec; scrollKey?: string; tabBar?: ReactNode }) {
  const { goBack } = useView();
  const t = useT();
  const scrollRef = useRef<HTMLElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [metas, setMetas] = useState<Meta[]>(grid.initial ?? []);
  const [page, setPage] = useState(grid.initial?.length ? 1 : 0);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);
  useScrollMemory(scrollKey ?? `grid:${grid.title}`, scrollRef);

  useEffect(() => {
    if (done) return;
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting || loadingRef.current) return;
        loadingRef.current = true;
        const next = page + 1;
        grid
          .fetcher(next)
          .then((batch) => {
            setPage(next);
            if (batch.length === 0 || next >= PAGE_CAP) {
              setDone(true);
              return;
            }
            setMetas((prev) => {
              const seen = new Set(prev.map((m) => m.id));
              const fresh = batch.filter((m) => !seen.has(m.id));
              if (fresh.length === 0) setDone(true);
              return [...prev, ...fresh];
            });
          })
          .catch((e) => {
            setError(e instanceof Error ? e.message : String(e));
            setDone(true);
          })
          .finally(() => {
            loadingRef.current = false;
          });
      },
      { rootMargin: "900px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [grid, page, done]);

  const hero = grid.kidsHero;
  const bgArt = metas.find((m) => m.background)?.background?.replace("/t/p/w780/", "/t/p/w1280/");

  const body = (
    <>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(185px,1fr))] gap-x-6 gap-y-10">
        {metas.map((m, i) => (
          <PickCard key={`${m.id}-${i}`} meta={m} kids={!!hero} />
        ))}
      </div>
      {!done && metas.length === 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(185px,1fr))] gap-x-6 gap-y-10">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="aspect-[2/3] animate-pulse rounded-xl bg-elevated/60" />
          ))}
        </div>
      )}
      {!done && <div ref={sentinelRef} className="h-24" />}
      {done &&
        metas.length === 0 &&
        (hero ? (
          <div className="flex flex-col items-center gap-3 py-24 text-center">
            <img src="/kids/doodles/lilpurpocto.png" alt="" draggable={false} className="h-20 w-auto opacity-80" />
            <p className="font-display text-[24px] font-bold text-[#0e3a43]">{t("Nothing here yet!")}</p>
          </div>
        ) : (
          <p className="py-20 text-center text-[14px] text-ink-subtle">
            {t("Nothing here yet.")} {error ? `(${error})` : ""}
          </p>
        ))}
    </>
  );

  return (
    <main ref={scrollRef} className="absolute inset-0 z-30 overflow-y-auto bg-canvas">
      {hero ? (
        <>
          <section className="relative h-[66vh] min-h-[460px] w-full overflow-hidden">
            {bgArt ? (
              <img
                src={bgArt}
                alt=""
                draggable={false}
                className="absolute inset-0 h-full w-full object-cover"
              />
            ) : (
              <div className={`absolute inset-0 bg-gradient-to-br ${hero.grad}`} />
            )}
            <div className={`pointer-events-none absolute inset-0 bg-gradient-to-tr ${hero.grad} opacity-25 mix-blend-overlay`} />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-canvas via-canvas/35 to-transparent" />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/45 via-black/10 to-transparent" />
            <img
              src={hero.art}
              alt=""
              draggable={false}
              className="pointer-events-none absolute bottom-0 end-0 h-[56%] w-auto max-w-[30%] object-contain object-bottom drop-shadow-[0_14px_28px_rgba(0,0,0,0.4)]"
            />
            <div className="absolute inset-x-0 bottom-0 flex flex-col items-start gap-2 px-12 pb-9">
              <h1 className="max-w-[62%] font-display text-[clamp(46px,7vw,88px)] font-extrabold leading-[0.92] tracking-tight text-white drop-shadow-[0_4px_18px_rgba(0,0,0,0.7)]">
                {hero.name}
              </h1>
              <p className="text-[18px] font-extrabold text-white/95 drop-shadow-[0_2px_10px_rgba(0,0,0,0.65)]">
                {metas.length} {metas.length === 1 ? t("title") : t("titles")}
              </p>
            </div>
          </section>
          <div className="flex w-full flex-col gap-8 px-12 pb-24 pt-6">{body}</div>
        </>
      ) : grid.backdrop || bgArt ? (
        <>
          <section className="relative h-[46vh] min-h-[340px] w-full overflow-hidden">
            <img src={grid.backdrop ?? bgArt} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover" />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-canvas via-canvas/40 to-transparent" />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/50 via-black/10 to-transparent rtl:bg-gradient-to-l" />
            {!layoutHasGlobalBack() && (
              <button
                onClick={goBack}
                aria-label="Back"
                className="absolute start-12 top-24 flex h-10 w-10 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-md transition-colors hover:bg-black/65"
              >
                <ArrowLeft size={18} strokeWidth={2.2} className="dir-icon" />
              </button>
            )}
            <div className="absolute inset-x-0 bottom-0 flex flex-col items-start gap-3 px-12 pb-8">
              {grid.logo ? (
                <img
                  src={grid.logo}
                  alt={grid.title}
                  draggable={false}
                  className="max-h-[120px] max-w-[min(520px,60%)] object-contain drop-shadow-[0_6px_24px_rgba(0,0,0,0.65)]"
                />
              ) : (
                <h1 className="font-display text-[clamp(34px,4.6vw,60px)] font-bold leading-none tracking-tight text-white drop-shadow-[0_4px_18px_rgba(0,0,0,0.7)]">
                  {grid.title}
                </h1>
              )}
            </div>
          </section>
          <div className="flex w-full flex-col gap-8 px-12 pb-24 pt-4">
            {tabBar}
            {body}
          </div>
        </>
      ) : (
        <div className="flex w-full flex-col gap-8 px-12 pb-24 pt-24">
          <div className="flex items-center gap-4">
            {!layoutHasGlobalBack() && (
              <button
                onClick={goBack}
                aria-label="Back"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-elevated text-ink-muted transition-colors hover:text-ink"
              >
                <ArrowLeft size={18} strokeWidth={2.2} />
              </button>
            )}
            <h1 className="font-display text-[30px] font-medium leading-none tracking-tight text-ink">
              {grid.title}
            </h1>
            <span className="text-[14px] text-ink-subtle">{metas.length} titles</span>
          </div>
          {tabBar}
          {body}
        </div>
      )}
      <BackToTop scrollRef={scrollRef} />
    </main>
  );
}
