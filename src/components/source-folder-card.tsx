import { useEffect, useRef, useState } from "react";
import { useView } from "@/lib/view";
import type { SourceFolder } from "@/lib/custom-sources";
import { useAuth } from "@/lib/auth";
import { buildFolderGrid } from "@/lib/nuvio/folder-grid";
import { useFolderBackdrop, useFolderLogo } from "@/lib/nuvio/logos";
import { Pencil, X } from "lucide-react";
import { createPortal } from "react-dom";
import { EditFolderImagesModal } from "./edit-folder-images-modal";
import { useT } from "@/lib/i18n";
import { useSettings } from "@/lib/settings";

export function SourceFolderCard({
  folder,
  editMode,
  sourceId,
  onEditFolderImages,
}: {
  folder: SourceFolder;
  editMode?: boolean;
  sourceId?: string;
  onEditFolderImages?: (sourceId: string, folderId: string, cover: string, gif: string) => void;
}) {
  const t = useT();
  const { settings } = useSettings();
  const { openGrid } = useView();
  const { authKey } = useAuth();
  const [hover, setHover] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorAddon, setErrorAddon] = useState<string | null>(null);
  const [missingTmdbKey, setMissingTmdbKey] = useState<false | "tmdb" | "mdblist">(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  const handleClick = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const res = await buildFolderGrid(folder, { tmdbKey: settings.tmdbKey, mdblistKey: settings.mdblistKey, authKey });
      if ("error" in res) {
        if (res.error === "tmdb-key") setMissingTmdbKey("tmdb");
        else if (res.error === "mdblist-key") setMissingTmdbKey("mdblist");
        else if (res.error === "addon") setErrorAddon(res.addonId);
        return;
      }
      openGrid(res);
    } finally {
      setLoading(false);
    }
  };

  const isLogo = !!folder.logo;
  const isPoster = !isLogo && folder.tileShape === "POSTER";
  const aspectRatio = isPoster ? "aspect-[2/3]" : "aspect-[16/9]";
  const showTitle = !folder.hideTitle && !isLogo;

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        disabled={loading}
        title={isLogo ? folder.title : undefined}
        className={`group/card relative ${aspectRatio} w-full flex-shrink-0 cursor-pointer overflow-hidden rounded-2xl border border-edge-soft text-start shadow-[0_4px_18px_-10px_rgba(0,0,0,0.5)] ring-1 ring-inset ring-white/0 transition-[border-color,transform] duration-300 hover:-translate-y-0.5 hover:border-edge hover:ring-white/15 ${
          isLogo ? "bg-gradient-to-br from-white/[0.07] to-white/[0.02]" : "bg-surface"
        }`}
      >
        {isLogo ? (
          <FolderLogoArt folder={folder} />
        ) : (
          <>
            {folder.coverImageUrl && (
              <img
                src={folder.coverImageUrl}
                alt=""
                loading="lazy"
                draggable={false}
                style={folder.coverCrop ? { transform: "scale(1.8)", transformOrigin: "100% 0%" } : undefined}
                className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${
                  hover && folder.focusGifUrl ? "opacity-0" : "opacity-100"
                }`}
              />
            )}
            {folder.focusGifUrl && (
              <img
                src={folder.focusGifUrl}
                alt=""
                loading="lazy"
                draggable={false}
                className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${
                  hover ? "opacity-100" : "opacity-0"
                }`}
              />
            )}
            {showTitle && (
              <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />
            )}
          </>
        )}
        <div aria-hidden className="absolute inset-0 bg-black/10 transition-colors duration-300 group-hover/card:bg-black/0" />

        {showTitle && (
          <h3 className="absolute inset-x-4 bottom-3.5 font-display text-[22px] font-bold leading-[1.15] text-white drop-shadow-[0_2px_14px_rgba(0,0,0,0.75)]">
            {folder.title}
          </h3>
        )}
        {loading && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/35">
            <span className="h-7 w-7 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          </span>
        )}

        {editMode && sourceId && onEditFolderImages && (
          <div
            className="absolute end-3 top-3 z-10"
            onClick={(e) => {
              e.stopPropagation();
              setIsEditModalOpen(true);
            }}
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-md transition-colors hover:bg-accent">
              <Pencil className="h-4 w-4" />
            </div>
          </div>
        )}
      </button>

    {errorAddon && createPortal(
      <div
        className="pointer-events-auto fixed inset-0 z-[120] flex items-center justify-center bg-black/72 backdrop-blur-md animate-in fade-in duration-200"
        onClick={(e) => {
          if (e.target === e.currentTarget) setErrorAddon(null);
        }}
      >
        <div className="flex w-full max-w-[420px] flex-col gap-6 rounded-[24px] border border-edge-soft bg-elevated/95 px-8 py-8 shadow-[0_30px_80px_-25px_rgba(0,0,0,0.85)] animate-in zoom-in-95 fade-in duration-200">
          <div className="flex items-start justify-between gap-4">
            <h2 className="text-[19px] font-medium tracking-tight text-ink">{t("Addon not installed")}</h2>
            <button
              onClick={() => setErrorAddon(null)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-canvas/40 text-ink-subtle transition-colors hover:bg-canvas/60 hover:text-ink"
            >
              <X size={16} />
            </button>
          </div>
          <div className="text-center text-ink-muted">
            <p className="mb-4 text-[15px]">
              {t("This section depends on the addon")} <strong className="text-ink" dir="ltr">{errorAddon}</strong>.
            </p>
            <p className="mb-6 text-[15px] leading-relaxed">
              {t("You must install this addon in your Stremio account first so Harbor can fetch its works.")}
            </p>
            <button
              onClick={() => setErrorAddon(null)}
              className="w-full rounded-full bg-accent px-6 py-2.5 font-medium text-white shadow-sm transition-opacity hover:opacity-90"
            >
              {t("OK")}
            </button>
          </div>
        </div>
      </div>,
      document.body,
    )}

    {missingTmdbKey && createPortal(
      <div
        className="pointer-events-auto fixed inset-0 z-[120] flex items-center justify-center bg-black/72 backdrop-blur-md animate-in fade-in duration-200"
        onClick={(e) => {
          if (e.target === e.currentTarget) setMissingTmdbKey(false);
        }}
      >
        <div className="flex w-full max-w-[420px] flex-col gap-6 rounded-[24px] border border-edge-soft bg-elevated/95 px-8 py-8 shadow-[0_30px_80px_-25px_rgba(0,0,0,0.85)] animate-in zoom-in-95 fade-in duration-200">
          <div className="flex items-start justify-between gap-4">
            <h2 className="text-[19px] font-medium tracking-tight text-ink">{missingTmdbKey === "mdblist" ? t("Missing MDBList key") : t("Missing TMDB Key")}</h2>
            <button
              onClick={() => setMissingTmdbKey(false)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-canvas/40 text-ink-subtle transition-colors hover:bg-canvas/60 hover:text-ink"
            >
              <X size={16} />
            </button>
          </div>
          <div className="text-center text-ink-muted">
            <p className="mb-4 text-[15px]">
              {missingTmdbKey === "mdblist" ? t("This section comes from an MDBList list.") : t("This section relies on TMDB discovery features.")}
            </p>
            <p className="mb-6 text-[15px] leading-relaxed">
              {missingTmdbKey === "mdblist"
                ? t("Add your free MDBList key in Settings › Library & Metadata (there's a Get key button next to it).")
                : t("Please add your TMDB API key in the Library & Metadata settings to view this folder.")}
            </p>
            <button
              onClick={() => setMissingTmdbKey(false)}
              className="w-full rounded-full bg-accent px-6 py-2.5 font-medium text-white shadow-sm transition-opacity hover:opacity-90"
            >
              {t("OK")}
            </button>
          </div>
        </div>
      </div>,
      document.body,
    )}

    {editMode && sourceId && onEditFolderImages && (
      <EditFolderImagesModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        initialCover={folder.coverImageUrl}
        initialGif={folder.focusGifUrl}
        onSave={(cover, gif) => {
          onEditFolderImages(sourceId, folder.id, cover, gif);
        }}
      />
    )}
    </>
  );
}

/** A company / network logo in its own colours over a dimmed backdrop of
 *  its best-known title. */
function FolderLogoArt({ folder }: { folder: SourceFolder }) {
  const { settings } = useSettings();
  const { authKey } = useAuth();
  const ref = useRef<HTMLSpanElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && setNear(true), { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);
  const entry = useFolderLogo(settings.tmdbKey, folder.logo, near);
  const bg = useFolderBackdrop(
    `bg:${folder.id}`,
    async () => {
      const res = await buildFolderGrid(folder, { tmdbKey: settings.tmdbKey, mdblistKey: settings.mdblistKey, authKey });
      if ("error" in res) return [];
      const tabs = res.tabs ?? [{ title: res.title, fetcher: res.fetcher }];
      const popular = tabs.find((t) => /مشهور|شعبي|popular/i.test(t.title)) ?? tabs[0];
      return popular.fetcher(1);
    },
    near,
  );
  return (
    <span ref={ref} className="absolute inset-0">
      {bg && (
        <img
          src={bg}
          alt=""
          loading="lazy"
          draggable={false}
          className="absolute inset-0 h-full w-full object-cover opacity-0 brightness-[0.38] saturate-[0.85] transition-[opacity,transform] duration-500 group-hover/card:scale-105 data-[on=true]:opacity-100"
          onLoad={(e) => e.currentTarget.setAttribute("data-on", "true")}
        />
      )}
      <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-black/25" />
      <span className="absolute inset-0 flex items-center justify-center p-[16%]">
        {entry?.url ? (
          <img
            src={entry.url}
            alt={folder.title}
            loading="lazy"
            draggable={false}
            className="max-h-full max-w-full object-contain drop-shadow-[0_4px_16px_rgba(0,0,0,0.7)] transition-transform duration-300 group-hover/card:scale-105"
            style={entry.dark ? { filter: "brightness(0) invert(1) drop-shadow(0 4px 16px rgba(0,0,0,0.7))" } : undefined}
          />
        ) : (
          <span className="text-center font-display text-[20px] font-bold text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.8)]">
            {entry ? folder.title : ""}
          </span>
        )}
      </span>
    </span>
  );
}
