import { ArrowRight, Type, X } from "lucide-react";
import tmdbLogo from "@/assets/addon-logos/tmdb.png";
import { useT } from "@/lib/i18n";
import { useOnboarding } from "@/lib/onboarding";
import { useSettings } from "@/lib/settings";
import { useView } from "@/lib/view";
import { openUrl } from "@/lib/window";

const KEY = "tmdb-nudge";

export function TmdbNudge({ suppress }: { suppress?: boolean } = {}) {
  const { settings } = useSettings();
  const { isDismissed, dismiss } = useOnboarding();
  const { openSettings } = useView();
  const t = useT();

  if (settings.tmdbKey || isDismissed(KEY) || suppress) return null;

  return (
    <div className="group animate-nudge-in flex items-center gap-4 rounded-2xl border border-edge-soft bg-elevated/95 px-5 py-4 backdrop-blur-md shadow-[0_18px_50px_-20px_rgba(0,0,0,0.6)]">
      <img
        src={tmdbLogo}
        alt="TMDB"
        className="h-10 w-10 shrink-0 rounded-full object-cover"
        draggable={false}
      />
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-medium text-ink">{t("Add your free TMDB key for Arabic titles and search")}</p>
        <p className="text-[12.5px] text-ink-subtle">
          {t("With your own key, titles and stories show in Arabic and you can search in Arabic. It takes a minute.")}
        </p>
      </div>
      <button
        onClick={() => openSettings("library")}
        className="flex h-9 items-center gap-1.5 rounded-full bg-ink px-4 text-[13px] font-semibold text-canvas transition-transform hover:scale-[1.03] active:scale-[0.97]"
      >
        {t("Set up")}
        <ArrowRight size={13} strokeWidth={2.6} className="dir-icon" />
      </button>
      <button
        onClick={() => dismiss(KEY)}
        aria-label={t("Dismiss")}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-subtle transition-colors hover:bg-raised hover:text-ink"
      >
        <X size={15} />
      </button>
    </div>
  );
}

const FONT_KEY = "thmanyah-font-nudge";
const THMANYAH_FONT_PAGE = "https://ask.thmanyah.com/hc/en-001/articles/45993930027281-Thmanyah-Font-for-Everyone";

/**
 * The Thmanyah font can't ship inside Harbor (its license forbids passing the
 * files on), so when it isn't installed we point to the official free download.
 * Once installed in Windows, Harbor uses it for every text and for subtitles.
 */
export function ThmanyahNudge({ suppress }: { suppress?: boolean } = {}) {
  const { isDismissed, dismiss } = useOnboarding();
  const t = useT();
  const installed =
    typeof document !== "undefined" && document.documentElement.hasAttribute("data-user-font");
  if (installed || isDismissed(FONT_KEY) || suppress) return null;

  return (
    <div className="group animate-nudge-in flex items-center gap-4 rounded-2xl border border-edge-soft bg-elevated/95 px-5 py-4 backdrop-blur-md shadow-[0_18px_50px_-20px_rgba(0,0,0,0.6)]">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
        <Type size={18} strokeWidth={2.2} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-medium text-ink">{t("Install the free Thmanyah font")}</p>
        <p className="text-[12.5px] text-ink-subtle">
          {t("Harbor and its subtitles use it automatically once it is installed in Windows. Restart Harbor after installing.")}
        </p>
      </div>
      <button
        onClick={() => openUrl(THMANYAH_FONT_PAGE)}
        className="flex h-9 items-center gap-1.5 rounded-full bg-ink px-4 text-[13px] font-semibold text-canvas transition-transform hover:scale-[1.03] active:scale-[0.97]"
      >
        {t("Get the font")}
        <ArrowRight size={13} strokeWidth={2.6} className="dir-icon" />
      </button>
      <button
        onClick={() => dismiss(FONT_KEY)}
        aria-label={t("Dismiss")}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-subtle transition-colors hover:bg-raised hover:text-ink"
      >
        <X size={15} />
      </button>
    </div>
  );
}
