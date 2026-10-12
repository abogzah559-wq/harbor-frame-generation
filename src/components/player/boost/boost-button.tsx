import { Loader2, Settings2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import { useSettings } from "@/lib/settings";
import {
  boostAttach,
  boostClearError,
  boostSetHost,
  boostSupported,
  boostToggle,
  useBoost,
} from "@/lib/boost";
import { Tooltip } from "../transport/tooltip";
import { BoostSettingsModal } from "./boost-settings-modal";

function FgIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="2.5" y="4" width="19" height="16" rx="3.5" stroke="currentColor" strokeWidth="1.8" />
      <text
        x="12"
        y="15.6"
        textAnchor="middle"
        fontSize="9"
        fontWeight="800"
        fill="currentColor"
        fontFamily="Segoe UI, system-ui, sans-serif"
      >
        FG
      </text>
    </svg>
  );
}

/**
 * Player-bar control: click toggles frame generation + upscaling inside
 * Harbor's mpv; the gear (or right-click) opens the settings panel.
 * `live` is false inside the layout-editor preview (no side effects there).
 */
export function BoostControl({
  variant,
  live,
  onMenuOpenChange,
}: {
  variant: "default" | "stremio";
  live: boolean;
  onMenuOpenChange?: (open: boolean) => void;
}) {
  const t = useT();
  const { settings } = useSettings();
  const { on, busy, error, progress } = useBoost();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const errTimer = useRef<number | null>(null);

  useEffect(() => {
    boostSetHost({ hwdec: settings.mpvHwdec, motionInterp: settings.playerMotionInterp });
  }, [settings.mpvHwdec, settings.playerMotionInterp]);

  useEffect(() => {
    onMenuOpenChange?.(settingsOpen);
  }, [settingsOpen, onMenuOpenChange]);

  useEffect(() => {
    if (!live) return;
    return boostAttach();
  }, [live]);

  useEffect(() => {
    if (!error) return;
    if (errTimer.current) window.clearTimeout(errTimer.current);
    errTimer.current = window.setTimeout(() => boostClearError(), 8000);
    return () => {
      if (errTimer.current) window.clearTimeout(errTimer.current);
    };
  }, [error]);

  if (live && !boostSupported()) return null;

  const big = variant === "stremio";
  const iconSize = big ? 26 : 22;
  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : null;
  const label = busy
    ? progress
      ? `${t("Downloading")} ${progress.step}${pct != null ? ` ${pct}%` : ""}`
      : t("Working…")
    : on
      ? t("Frame Generation: On")
      : t("Frame Generation: Off");

  const main = (
    <button
      type="button"
      onClick={() => {
        if (live) void boostToggle();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        setSettingsOpen(true);
      }}
      disabled={busy}
      aria-label={t("Toggle frame generation")}
      aria-pressed={on}
      className={`pointer-events-auto relative flex items-center justify-center transition-[background-color,color] ${
        big ? "h-16 w-14 rounded-s-xl" : "h-12 w-11 rounded-s-full ps-1"
      } ${
        on
          ? big
            ? "bg-white/[0.08] text-[#b9b4ff]"
            : "bg-white/22 text-[#c9c5ff] hover:bg-white/30"
          : big
            ? "text-white/90 hover:bg-white/[0.05]"
            : "text-white/85 hover:bg-white/10 hover:text-white"
      }`}
    >
      {busy ? <Loader2 size={iconSize - 2} className="animate-spin" /> : <FgIcon size={iconSize} />}
      {busy && pct != null && (
        <span className="absolute bottom-1 text-[9px] font-bold tabular-nums text-white/90">{pct}%</span>
      )}
      {on && !busy && (
        <span className="absolute bottom-2 end-1.5 h-1.5 w-1.5 rounded-full bg-[#a39ff5] shadow-[0_0_6px_#a39ff5]" />
      )}
    </button>
  );

  const gear = (
    <button
      type="button"
      onClick={() => setSettingsOpen(true)}
      aria-label={t("Frame generation settings")}
      className={`pointer-events-auto flex items-center justify-center text-white/60 transition-colors hover:text-white ${
        big ? "h-16 w-7 rounded-e-xl hover:bg-white/[0.05]" : "h-12 w-6 rounded-e-full pe-1 hover:bg-white/10"
      } ${on ? (big ? "bg-white/[0.08]" : "bg-white/22") : ""}`}
    >
      <Settings2 size={big ? 16 : 14} />
    </button>
  );

  return (
    <div className="relative flex items-center">
      <Tooltip label={label}>{main}</Tooltip>
      <Tooltip label={t("Frame generation settings")}>{gear}</Tooltip>
      {error && (
        <div
          role="alert"
          onClick={() => boostClearError()}
          className="pointer-events-auto absolute bottom-[calc(100%+10px)] end-0 w-[320px] cursor-pointer rounded-xl border border-red-400/30 bg-black/85 px-3 py-2 text-[12.5px] leading-snug text-red-200 shadow-xl backdrop-blur-md"
        >
          {error}
        </div>
      )}
      {settingsOpen && <BoostSettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
