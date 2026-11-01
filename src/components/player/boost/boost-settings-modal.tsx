import { Check, ChevronDown, Download, Gauge, Loader2, Minus, Plus, RotateCcw, Sparkles, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/lib/i18n";
import {
  BOOST_MODELS,
  DEFAULT_BOOST_CONFIG,
  boostSaveConfig,
  boostRecalibrate,
  boostStatus,
  useBoost,
  type BoostConfig,
  type BoostProfile,
  type BoostStatus,
} from "@/lib/boost";

/*
 * Boost settings, drawn with Harbor's own tokens (canvas / elevated / edge /
 * ink / accent) so it follows the active theme and reads right-to-left in
 * Arabic. Every visible string goes through t().
 */

type T = (key: string, vars?: Record<string, string | number>) => string;
type Opt<V extends string | number> = { value: V; label: string; hint?: string };

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-edge-soft bg-canvas/40 p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <span className="text-[13.5px] font-medium text-ink">{label}</span>
        {hint && <span className="text-[12px] leading-snug text-ink-muted">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Pills<V extends string | number>({
  value,
  options,
  onChange,
}: {
  value: V;
  options: Opt<V>[];
  onChange: (v: V) => void;
}) {
  return (
    <div className="flex w-fit max-w-full flex-wrap gap-1 rounded-2xl bg-elevated/50 p-1 ring-1 ring-edge-soft/60">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          onClick={() => onChange(o.value)}
          title={o.hint}
          className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors ${
            value === o.value ? "bg-ink text-canvas" : "text-ink-muted hover:bg-raised hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Switch({ label, hint, on, onChange }: { label: string; hint?: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="flex items-center justify-between gap-4 rounded-xl px-1 py-1 text-start"
    >
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[13.5px] font-medium text-ink">{label}</span>
        {hint && <span className="text-[12px] leading-snug text-ink-muted">{hint}</span>}
      </span>
      <span aria-hidden className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${on ? "bg-ink" : "bg-edge"}`}>
        <span
          className={`absolute start-[2px] top-0.5 h-5 w-5 rounded-full bg-canvas transition-transform ${
            on ? "translate-x-4 rtl:-translate-x-4" : "translate-x-0"
          }`}
        />
      </span>
    </button>
  );
}

function Stepper({
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  return (
    <div className="flex h-10 w-fit items-center gap-1 rounded-full bg-elevated/50 p-1 ring-1 ring-edge-soft/60">
      <button
        type="button"
        onClick={() => onChange(clamp(value - step))}
        className="flex h-8 w-8 items-center justify-center rounded-full text-ink-muted hover:bg-raised hover:text-ink"
        aria-label="-"
      >
        <Minus size={14} />
      </button>
      <span className="min-w-[64px] text-center text-[13px] font-semibold tabular-nums text-ink">
        {value}
        {suffix}
      </span>
      <button
        type="button"
        onClick={() => onChange(clamp(value + step))}
        className="flex h-8 w-8 items-center justify-center rounded-full text-ink-muted hover:bg-raised hover:text-ink"
        aria-label="+"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}

function Range({
  value,
  min,
  max,
  step = 1,
  suffix = "",
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="hb-range h-1.5 w-full cursor-pointer appearance-none rounded-full"
        style={{
          background: `linear-gradient(to var(--hb-dir, right), var(--color-accent) ${pct}%, var(--color-edge) ${pct}%)`,
        }}
      />
      <span className="w-10 text-end text-[12.5px] font-semibold tabular-nums text-ink-muted">
        {value}
        {suffix}
      </span>
    </div>
  );
}

function ModelList({ value, onChange, t }: { value: BoostProfile["model"]; onChange: (v: BoostProfile["model"]) => void; t: T }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {BOOST_MODELS.map((m) => {
        const active = m.id === value;
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => onChange(m.id)}
            className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-start transition-colors ${
              active ? "border-accent bg-accent-soft" : "border-edge-soft hover:border-edge hover:bg-raised/40"
            }`}
          >
            <span className="flex min-w-0 flex-col">
              <span className="text-[13px] font-semibold text-ink">{m.label}</span>
              <span className="text-[11.5px] text-ink-muted">{t(m.note)}</span>
            </span>
            {active && <Check size={15} className="shrink-0 text-accent" />}
          </button>
        );
      })}
    </div>
  );
}

function mb(n: number) {
  return `${(n / 1048576).toFixed(1)} MB`;
}

export function BoostSettingsModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { config: saved, error, notice, progress, plan, calibrating, gpuNow } = useBoost();
  const [cfg, setCfg] = useState<BoostConfig>(saved);
  const [status, setStatus] = useState<BoostStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const p = cfg.profile;
  const set = (patch: Partial<BoostProfile>) => setCfg((c) => ({ ...c, profile: { ...c.profile, ...patch } }));

  useEffect(() => {
    boostStatus().then(setStatus).catch(() => setStatus(null));
  }, [progress]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const save = async () => {
    setSaving(true);
    await boostSaveConfig(cfg);
    setSaving(false);
    onClose();
  };

  const needsDownload =
    !!status &&
    ((p.scalingType !== "Off" && !status.shaders) ||
      (p.frameGeneration === "RIFE" && (!status.runtime || !status.rife || !status.models.includes(p.model))));

  const fgOptions: Opt<BoostProfile["frameGeneration"]>[] = [
    { value: "Off", label: t("Off") },
    { value: "RIFE", label: t("AI (RIFE)") },
    { value: "Smooth", label: t("Smooth") },
  ];
  const fgHint =
    p.frameGeneration === "RIFE"
      ? t("Creates new in-between frames with AI. Smoothest, needs a capable GPU.")
      : p.frameGeneration === "Smooth"
        ? t("Blends frames to your screen's refresh rate. Very light, works on any GPU.")
        : t("Frame generation is off. Upscaling can still be used.");

  const resOptions: Opt<BoostProfile["procRes"]>[] = [
    { value: "auto", label: t("Auto") },
    { value: "1080", label: "1080p" },
    { value: "720", label: "720p" },
  ];
  const resHint =
    p.procRes === "auto"
      ? t("Up to 1080p, lower only if your GPU needs it. 4K and 1440p videos are processed at 1080p and upscaled back.")
      : t("Larger videos are scaled down before frame generation, then upscaled back to your screen.");
  const outHint =
    p.fgMode === "auto"
      ? t("Picks the smoothest frame rate that fits your GPU limit and divides your screen's refresh rate evenly.")
      : p.fgMode === "fixed"
        ? t("Tip: X2 on a 24 fps episode gives 48 fps. Higher needs a strong GPU.")
        : t("Your own frame rate, capped at the screen's refresh rate.");

  const scaleOptions: Opt<BoostProfile["scalingType"]>[] = [
    { value: "Off", label: t("Off") },
    { value: "FSR", label: "FSR" },
    { value: "NIS", label: "NIS" },
    { value: "CAS", label: "CAS" },
  ];

  const host = (typeof document !== "undefined" && (document.fullscreenElement as HTMLElement | null)) || document.body;

  const components: Array<{ label: string; ok: boolean; show: boolean }> = [
    { label: t("Upscaling shaders"), ok: !!status?.shaders, show: true },
    { label: t("VapourSynth runtime"), ok: !!status?.runtime, show: true },
    { label: t("RIFE engine"), ok: !!status?.rife, show: true },
    { label: t("Model {m}", { m: p.model }), ok: !!status?.models.includes(p.model), show: p.frameGeneration === "RIFE" },
  ];

  return createPortal(
    <div
      className="fixed inset-0 z-[2147483000] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => e.stopPropagation()}
      onKeyUp={(e) => e.stopPropagation()}
    >
      <style>{`
        .hb-range::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:16px;height:16px;border-radius:9999px;background:var(--color-ink);border:3px solid var(--color-accent)}
        [dir="rtl"] .hb-range{--hb-dir:left}
        .hb-scroll::-webkit-scrollbar{width:8px}.hb-scroll::-webkit-scrollbar-thumb{background:var(--color-edge);border-radius:8px}
      `}</style>
      <div className="flex max-h-[92vh] w-[620px] max-w-full flex-col overflow-hidden rounded-[28px] border border-edge bg-elevated text-ink shadow-[0_30px_80px_-20px_rgba(0,0,0,0.85)]">
        <header className="flex items-center gap-3 px-5 pb-3 pt-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent">
            <Sparkles size={19} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[16px] font-semibold text-ink">{t("Harbor Boost")}</h2>
            <p className="truncate text-[12.5px] text-ink-muted">{t("Runs inside Harbor's player. No other program needed.")}</p>
          </div>
          <button
            type="button"
            onClick={() => setCfg(DEFAULT_BOOST_CONFIG)}
            className="flex h-9 w-9 items-center justify-center rounded-full text-ink-muted hover:bg-raised hover:text-ink"
            title={t("Reset to defaults")}
            aria-label={t("Reset to defaults")}
          >
            <RotateCcw size={15} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full text-ink-muted hover:bg-raised hover:text-ink"
            aria-label={t("Close")}
          >
            <X size={18} />
          </button>
        </header>

        <div className="hb-scroll flex flex-1 flex-col gap-3 overflow-y-auto px-5 pb-4">
          <Section title={t("Frame generation")}>
            <Field label={t("Type")} hint={fgHint}>
              <Pills value={p.frameGeneration} options={fgOptions} onChange={(v) => set({ frameGeneration: v })} />
            </Field>

            {p.frameGeneration === "RIFE" && (calibrating || plan) && (
              <div className="flex items-center gap-3 rounded-xl bg-accent-soft px-3 py-2.5">
                {calibrating ? (
                  <Loader2 size={18} className="shrink-0 animate-spin text-accent" />
                ) : (
                  <Gauge size={18} className="shrink-0 text-accent" />
                )}
                <div className="flex min-w-0 flex-col">
                  {calibrating ? (
                    <span className="text-[13px] font-semibold text-ink">{t("Measuring your GPU…")}</span>
                  ) : plan ? (
                    <>
                      <span className="text-[13px] font-semibold text-ink" dir="ltr">
                        {plan.srcHeight}p {plan.height < plan.srcHeight ? `→ ${plan.height}p ` : ""}· {plan.outFps} fps · {gpuNow != null ? `GPU ${gpuNow}% / ${saved.profile.maxGpu}%` : `≈${plan.gpu}% GPU`}
                      </span>
                      <span className="text-[11.5px] text-ink-muted">
                        {t("Now playing. Screen {hz} Hz, your GPU does {f} fps at 1080p with this model.", {
                          hz: plan.refresh,
                          f: plan.speed1080,
                        })}
                      </span>
                    </>
                  ) : null}
                </div>
              </div>
            )}

            {p.frameGeneration === "RIFE" && (
              <>
                <Field label={t("Model")}>
                  <ModelList value={p.model} onChange={(v) => set({ model: v })} t={t} />
                </Field>

                <Field label={t("Output")} hint={outHint}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Pills
                      value={p.fgMode}
                      options={[
                        { value: "auto", label: t("Auto") },
                        { value: "fixed", label: t("Multiplier") },
                        { value: "target", label: t("Target FPS") },
                      ]}
                      onChange={(v) => set({ fgMode: v })}
                    />
                    {p.fgMode === "auto" ? null : p.fgMode === "fixed" ? (
                      <Pills
                        value={p.multiplier}
                        options={[
                          { value: 2, label: "×2" },
                          { value: 3, label: "×3" },
                          { value: 4, label: "×4" },
                        ]}
                        onChange={(v) => set({ multiplier: v })}
                      />
                    ) : (
                      <Stepper value={Math.max(30, p.target)} min={30} max={240} step={6} suffix=" fps" onChange={(v) => set({ target: v })} />
                    )}
                  </div>
                </Field>

                <Field label={t("Processing resolution")} hint={resHint}>
                  <Pills value={p.procRes} options={resOptions} onChange={(v) => set({ procRes: v })} />
                </Field>

                <Field
                  label={t("GPU limit")}
                  hint={t("Boost keeps total GPU use under this, lowering frame rate or resolution when needed.")}
                >
                  <Range value={p.maxGpu} min={50} max={95} step={5} suffix="%" onChange={(v) => set({ maxGpu: v })} />
                </Field>

                <div className="flex flex-col gap-1 border-t border-edge-soft pt-2">
                  <Switch
                    label={t("Scene detection")}
                    hint={t("Skips blending across hard cuts, so scene changes stay clean.")}
                    on={p.sceneDetect}
                    onChange={(v) => set({ sceneDetect: v })}
                  />
                  <Switch
                    label={t("Faster motion estimation")}
                    hint={t("Estimates motion at half resolution. Lighter, slightly less precise.")}
                    on={p.flowScale < 75}
                    onChange={(v) => set({ flowScale: v ? 50 : 100 })}
                  />
                </div>
              </>
            )}
          </Section>

          <Section title={t("Upscaling")}>
            <Field label={t("Type")} hint={t("Sharpens the picture when it is scaled up to your screen.")}>
              <Pills value={p.scalingType} options={scaleOptions} onChange={(v) => set({ scalingType: v })} />
            </Field>
            {p.scalingType !== "Off" && (
              <Field label={t("Sharpness")}>
                <Range value={p.sharpness} min={0} max={10} onChange={(v) => set({ sharpness: v })} />
              </Field>
            )}
          </Section>

          <Section title={t("General")}>
            <Switch
              label={t("Stay on for the next episodes")}
              on={cfg.remember}
              onChange={(v) => setCfg((c) => ({ ...c, remember: v }))}
            />
          </Section>

          {p.frameGeneration === "RIFE" && (
            <Section
              title={t("Advanced")}
              aside={
                <button
                  type="button"
                  onClick={() => setAdvanced((v) => !v)}
                  className="flex items-center gap-1 rounded-full px-2 py-1 text-[12px] font-semibold text-ink-muted hover:bg-raised hover:text-ink"
                >
                  {advanced ? t("Hide") : t("Show")}
                  <ChevronDown size={14} className={`transition-transform ${advanced ? "rotate-180" : ""}`} />
                </button>
              }
            >
              {advanced && (
                <>
                  <Field label={t("Graphics card")} hint={t("Auto picks the dedicated GPU. Change it only if frame generation runs on the wrong one.")}>
                    <Pills
                      value={p.gpuId}
                      options={[
                        { value: -1, label: t("Auto") },
                        { value: 0, label: "GPU 0" },
                        { value: 1, label: "GPU 1" },
                        { value: 2, label: "GPU 2" },
                      ]}
                      onChange={(v) => set({ gpuId: v })}
                    />
                  </Field>
                  <Field
                    label={t("Measure GPU again")}
                    hint={t("Use after changing the graphics card or driver. Takes a few seconds.")}
                  >
                    <button
                      type="button"
                      disabled={calibrating}
                      onClick={() => void boostRecalibrate()}
                      className="flex h-9 w-fit items-center gap-2 rounded-full bg-elevated/50 px-4 text-[12.5px] font-semibold text-ink ring-1 ring-edge-soft/60 hover:bg-raised disabled:opacity-60"
                    >
                      {calibrating ? <Loader2 size={14} className="animate-spin" /> : <Gauge size={14} />}
                      {t("Measure now")}
                    </button>
                  </Field>
                  <Field label={t("GPU threads")}>
                    <Stepper value={p.gpuThreads} min={1} max={4} onChange={(v) => set({ gpuThreads: v })} />
                  </Field>
                </>
              )}
            </Section>
          )}

          <Section title={t("Components")}>
            <div className="flex flex-wrap gap-1.5">
              {components
                .filter((c) => c.show)
                .map((c) => (
                  <span
                    key={c.label}
                    className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium ring-1 ${
                      c.ok ? "text-success ring-success/35" : "text-ink-muted ring-edge-soft"
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${c.ok ? "bg-success" : "bg-ink-subtle"}`} />
                    {c.label}
                    <span className="text-ink-subtle">· {c.ok ? t("Ready") : t("Not downloaded")}</span>
                  </span>
                ))}
            </div>
            {progress ? (
              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between text-[12px] text-ink-muted">
                  <span>
                    {t("Downloading")} {progress.step}…
                  </span>
                  <span className="tabular-nums">
                    {progress.total ? `${mb(progress.done)} / ${mb(progress.total)}` : mb(progress.done)}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-edge-soft">
                  <div
                    className="h-full rounded-full bg-accent transition-[width]"
                    style={{ width: progress.total ? `${Math.min(100, (progress.done / progress.total) * 100)}%` : "30%" }}
                  />
                </div>
              </div>
            ) : needsDownload ? (
              <div className="flex items-center gap-2 text-[12px] text-ink-muted">
                <Download size={14} />
                {p.frameGeneration === "RIFE"
                  ? t("About 60 MB downloads once, the first time you turn it on.")
                  : t("A small download happens once, the first time you turn it on.")}
              </div>
            ) : null}
          </Section>
        </div>

        <footer className="flex items-center gap-2 border-t border-edge-soft px-5 py-3">
          <div
            className={`min-w-0 flex-1 truncate text-[12px] ${error ? "text-danger" : "text-ink-muted"}`}
            title={error ?? notice ?? ""}
          >
            {error ?? status?.primeError ?? notice ?? ""}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-full px-4 text-[13px] font-semibold text-ink-muted hover:bg-raised hover:text-ink"
          >
            {t("Cancel")}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="h-9 rounded-full bg-ink px-5 text-[13px] font-semibold text-canvas transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {saving ? t("Applying…") : t("Save")}
          </button>
        </footer>
      </div>
    </div>,
    host,
  );
}
