import { CheckCircle2, Download, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { RELEASES_URL, installSelfUpdateNow, startSelfUpdate, takeJustUpdated, useSelfUpdate } from "@/lib/selfupdate";
import { useT } from "@/lib/i18n";
import { useView } from "@/lib/view";
import { openUrl } from "@/lib/window";

/** Starts the silent updater and, right after an update, shows a small green
 *  note for a few seconds with a Details button. */
export function UpdatedToast() {
  const t = useT();
  const [tag, setTag] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const hover = useRef(false);

  useEffect(() => {
    startSelfUpdate();
    const just = takeJustUpdated();
    if (!just) return;
    setTag(just);
    const show = window.setTimeout(() => setVisible(true), 1200);
    let hide = 0;
    const scheduleHide = () => {
      hide = window.setTimeout(() => (hover.current ? scheduleHide() : setVisible(false)), 3000);
    };
    const start = window.setTimeout(scheduleHide, 1200);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(start);
      window.clearTimeout(hide);
    };
  }, []);

  if (!tag) return <UpdateReadyNote />;
  return createPortal(
    <div
      onMouseEnter={() => (hover.current = true)}
      onMouseLeave={() => (hover.current = false)}
      className={`fixed bottom-6 left-1/2 z-[130] flex -translate-x-1/2 items-center gap-3 rounded-full border border-emerald-400/30 bg-emerald-600/90 py-2 ps-3 pe-2 text-white shadow-[0_14px_40px_rgba(0,0,0,0.45)] backdrop-blur-md transition-all duration-500 ${
        visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-4 opacity-0"
      }`}
    >
      <CheckCircle2 size={18} strokeWidth={2.4} />
      <span className="text-[13.5px] font-semibold">{t("Harbor was updated to {tag}", { tag })}</span>
      <button
        type="button"
        onClick={() => openUrl(`${RELEASES_URL}/tag/${tag}`)}
        className="rounded-full bg-white/20 px-3 py-1 text-[12.5px] font-semibold transition-colors hover:bg-white/30"
      >
        {t("Details")}
      </button>
    </div>,
    document.body,
  );
}

/** Once a new release has downloaded: a small note with "Restart now".
 *  Hidden while a video plays; "Later" leaves it for when Harbor closes. */
function UpdateReadyNote() {
  const t = useT();
  const u = useSelfUpdate();
  const { topKind } = useView();
  const [later, setLater] = useState(false);
  if (u.status !== "ready" || !u.tag || later || topKind === "player") return null;
  return createPortal(
    <div className="fixed bottom-6 left-1/2 z-[130] flex -translate-x-1/2 items-center gap-3 rounded-full border border-edge bg-raised/95 py-2 ps-3 pe-2 text-ink shadow-[0_14px_40px_rgba(0,0,0,0.45)] backdrop-blur-md">
      <Download size={17} strokeWidth={2.4} className="text-accent" />
      <span className="text-[13.5px] font-semibold">{t("{tag} is ready to install", { tag: u.tag })}</span>
      <button
        type="button"
        onClick={installSelfUpdateNow}
        className="rounded-full bg-accent px-3 py-1 text-[12.5px] font-semibold text-[#1b1304] transition-[filter] hover:brightness-105"
      >
        {t("Restart now")}
      </button>
      <button
        type="button"
        onClick={() => setLater(true)}
        aria-label={t("Later")}
        className="rounded-full p-1.5 text-ink-subtle transition-colors hover:bg-white/10 hover:text-ink"
      >
        <X size={14} strokeWidth={2.4} />
      </button>
    </div>,
    document.body,
  );
}
