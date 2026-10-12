import { Download, RotateCcw, X, ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/lib/i18n";
import {
  BOOST_MODELS,
  DEFAULT_BOOST_CONFIG,
  boostSaveConfig,
  boostStatus,
  useBoost,
  type BoostConfig,
  type BoostProfile,
  type BoostStatus,
} from "@/lib/boost";

// Look & feel copied from Lossless Scaling's own (WinUI/Fluent dark) window.
const C = {
  page: "#2b2b2b",
  card: "#373737",
  cardEdge: "#3f3f3f",
  field: "#3d3d3d",
  fieldHover: "#454545",
  fieldEdge: "#4a4a4a",
  text: "#ffffff",
  sub: "#cfcfcf",
  accent: "#a39ff5",
};

type Opt<V extends string | number> = { value: V; label: string };

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section
      className="rounded-lg px-4 pb-4 pt-3"
      style={{ background: C.card, border: `1px solid ${C.cardEdge}` }}
    >
      <h3 className="mb-3 text-[19px] font-semibold" style={{ color: C.text }}>
        {title}
      </h3>
      <div className="flex flex-col gap-2.5">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[36px] items-center justify-between gap-4">
      <span className="text-[14px] font-semibold" style={{ color: C.text }}>
        {label}
      </span>
      <div className="flex w-[200px] shrink-0 justify-end">{children}</div>
    </div>
  );
}

function Select<V extends string | number>({
  value,
  options,
  onChange,
}: {
  value: V;
  options: Opt<V>[];
  onChange: (v: V) => void;
}) {
  return (
    <div className="relative w-full">
      <select
        value={String(value)}
        onChange={(e) => {
          const raw = e.target.value;
          const hit = options.find((o) => String(o.value) === raw);
          if (hit) onChange(hit.value);
        }}
        className="h-9 w-full cursor-pointer appearance-none truncate rounded-[5px] pe-8 ps-3 text-[14px] outline-none transition-colors"
        style={{ background: C.field, border: `1px solid ${C.fieldEdge}`, color: C.text }}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)} style={{ background: C.field }}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={15}
        className="pointer-events-none absolute end-2.5 top-1/2 -translate-y-1/2"
        style={{ color: C.sub }}
      />
    </div>
  );
}

function Spin({
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n / step) * step));
  const commit = (s: string) => {
    const n = Number(s);
    if (Number.isFinite(n)) onChange(Number(clamp(n).toFixed(2)));
    else setText(String(value));
  };
  return (
    <div
      className="flex h-9 w-full items-center rounded-[5px]"
      style={{ background: C.field, border: `1px solid ${C.fieldEdge}` }}
    >
      <input
        value={text}
        inputMode="decimal"
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
          e.stopPropagation();
        }}
        className="h-full min-w-0 flex-1 bg-transparent px-3 text-[14px] outline-none"
        style={{ color: C.text }}
      />
      <button
        type="button"
        onClick={() => onChange(Number(clamp(value + step).toFixed(2)))}
        className="flex h-full w-8 items-center justify-center hover:bg-white/5"
        style={{ color: C.sub }}
        aria-label="+"
      >
        <ChevronUp size={15} />
      </button>
      <button
        type="button"
        onClick={() => onChange(Number(clamp(value - step).toFixed(2)))}
        className="flex h-full w-8 items-center justify-center hover:bg-white/5"
        style={{ color: C.sub }}
        aria-label="-"
      >
        <ChevronDown size={15} />
      </button>
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="flex items-center gap-3"
    >
      <span
        className="relative inline-block h-5 w-10 rounded-full transition-colors"
        style={{
          background: on ? C.accent : "transparent",
          border: on ? `1px solid ${C.accent}` : "1px solid #cfcfcf",
        }}
      >
        <span
          className="absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full transition-all"
          style={{ background: on ? "#000" : "#cfcfcf", left: on ? 23 : 3 }}
        />
      </span>
      <span className="w-7 text-start text-[14px]" style={{ color: C.text }}>
        {on ? "On" : "Off"}
      </span>
    </button>
  );
}

function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="flex w-full items-center gap-2" title={String(value)}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="ls-range h-1 w-full cursor-pointer appearance-none rounded-full"
        style={{ background: `linear-gradient(to right, ${C.accent} ${pct}%, #9a9a9a ${pct}%)` }}
      />
      <span className="w-8 text-end text-[12px] tabular-nums" style={{ color: C.sub }}>
        {value}
      </span>
    </div>
  );
}

const FRAME_GEN: Opt<BoostProfile["frameGeneration"]>[] = [
  { value: "Off", label: "Off" },
  { value: "RIFE", label: "RIFE (AI)" },
  { value: "Smooth", label: "Smooth (blend)" },
];
const SCALING: Opt<BoostProfile["scalingType"]>[] = [
  { value: "Off", label: "Off" },
  { value: "FSR", label: "FSR" },
  { value: "NIS", label: "NIS" },
  { value: "CAS", label: "CAS" },
];

function mb(n: number) {
  return `${(n / 1048576).toFixed(1)} MB`;
}

export function BoostSettingsModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { config: saved, error, progress } = useBoost();
  const [cfg, setCfg] = useState<BoostConfig>(saved);
  const [status, setStatus] = useState<BoostStatus | null>(null);
  const [saving, setSaving] = useState(false);
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

  const host = (typeof document !== "undefined" && (document.fullscreenElement as HTMLElement | null)) || document.body;

  return createPortal(
    <div
      className="fixed inset-0 z-[2147483000] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => e.stopPropagation()}
      onKeyUp={(e) => e.stopPropagation()}
    >
      <style>{`
        .ls-range::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:20px;height:20px;border-radius:9999px;background:${C.accent};border:5px solid #454545;box-shadow:0 0 0 1px #555}
        .ls-scroll::-webkit-scrollbar{width:8px}.ls-scroll::-webkit-scrollbar-thumb{background:#555;border-radius:8px}
      `}</style>
      <div
        dir="ltr"
        className="flex max-h-[92vh] w-[980px] max-w-full flex-col overflow-hidden rounded-xl shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)]"
        style={{ background: C.page, border: `1px solid ${C.cardEdge}`, fontFamily: "'Segoe UI Variable','Segoe UI',system-ui,sans-serif" }}
      >
        <div className="flex items-center gap-3 px-5 py-3" style={{ borderBottom: `1px solid ${C.cardEdge}` }}>
          <div
            className="flex h-8 w-8 items-center justify-center rounded-md text-[12px] font-black"
            style={{ background: C.accent, color: "#000" }}
          >
            FG
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold text-white">{t("Frame Generation & Scaling")}</div>
            <div className="truncate text-[12px]" style={{ color: C.sub }}>
              {t("Runs inside Harbor's player. No other program needed.")}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setCfg(DEFAULT_BOOST_CONFIG)}
            className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] text-white/85 hover:bg-white/10"
            title={t("Reset to defaults")}
          >
            <RotateCcw size={14} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md text-white/85 hover:bg-white/10"
            aria-label={t("Close")}
          >
            <X size={18} />
          </button>
        </div>

        <div className="ls-scroll grid flex-1 grid-cols-1 gap-3 overflow-y-auto p-4 md:grid-cols-2">
          <div className="flex flex-col gap-3">
            <Card title="Frame Generation">
              <Row label="Type">
                <Select value={p.frameGeneration} options={FRAME_GEN} onChange={(v) => set({ frameGeneration: v })} />
              </Row>
              {p.frameGeneration === "RIFE" && (
                <>
                  <Row label="Model">
                    <Select
                      value={p.model}
                      options={BOOST_MODELS.map((m) => ({ value: m.id, label: `${m.label} · ${m.note}` }))}
                      onChange={(v) => set({ model: v })}
                    />
                  </Row>
                  <Row label="Mode">
                    <Select
                      value={p.fgMode}
                      options={[
                        { value: "fixed", label: "Fixed" },
                        { value: "adaptive", label: "Adaptive" },
                      ]}
                      onChange={(v) => set({ fgMode: v })}
                    />
                  </Row>
                  {p.fgMode === "fixed" ? (
                    <Row label="Multiplier">
                      <Select
                        value={p.multiplier}
                        options={[
                          { value: 2, label: "X2" },
                          { value: 3, label: "X3" },
                          { value: 4, label: "X4" },
                        ]}
                        onChange={(v) => set({ multiplier: v })}
                      />
                    </Row>
                  ) : (
                    <Row label="Target">
                      <Spin value={p.target} min={0} max={240} onChange={(v) => set({ target: v })} />
                    </Row>
                  )}
                  <Row label="Flow scale">
                    <Slider value={p.flowScale} min={25} max={100} step={25} onChange={(v) => set({ flowScale: v })} />
                  </Row>
                  <Row label="Scene detection">
                    <Toggle on={p.sceneDetect} onChange={(v) => set({ sceneDetect: v })} />
                  </Row>
                  <p className="text-[12px] leading-snug" style={{ color: C.sub }}>
                    {p.fgMode === "adaptive"
                      ? t("Adaptive: target 0 follows your screen's refresh rate (capped at it).")
                      : t("Tip: X2 on a 24 fps episode gives 48 fps. Higher needs a strong GPU.")}
                  </p>
                </>
              )}
              {p.frameGeneration === "Smooth" && (
                <p className="text-[12px] leading-snug" style={{ color: C.sub }}>
                  {t("Blends frames to your screen's refresh rate. Very light, works on any GPU.")}
                </p>
              )}
            </Card>

            {p.frameGeneration === "RIFE" && (
              <Card title="GPU">
                <Row label="Preferred GPU">
                  <Select
                    value={p.gpuId}
                    options={[
                      { value: -1, label: "Auto" },
                      { value: 0, label: "GPU 0" },
                      { value: 1, label: "GPU 1" },
                      { value: 2, label: "GPU 2" },
                    ]}
                    onChange={(v) => set({ gpuId: v })}
                  />
                </Row>
                <Row label="GPU threads">
                  <Spin value={p.gpuThreads} min={1} max={4} onChange={(v) => set({ gpuThreads: v })} />
                </Row>
              </Card>
            )}
          </div>

          <div className="flex flex-col gap-3">
            <Card title="Scaling">
              <Row label="Type">
                <Select value={p.scalingType} options={SCALING} onChange={(v) => set({ scalingType: v })} />
              </Row>
              {p.scalingType !== "Off" && (
                <Row label="Sharpness">
                  <Slider value={p.sharpness} min={0} max={10} onChange={(v) => set({ sharpness: v })} />
                </Row>
              )}
            </Card>

            <Card title="Behavior">
              <Row label={t("Stay on for the next episodes")}>
                <Toggle on={cfg.remember} onChange={(v) => setCfg((c) => ({ ...c, remember: v }))} />
              </Row>
            </Card>

            <Card title="Components">
              <StatusLine label="Upscaling shaders" ok={!!status?.shaders} />
              <StatusLine label="VapourSynth runtime" ok={!!status?.runtime} />
              <StatusLine label="RIFE engine" ok={!!status?.rife} />
              <StatusLine label={`Model ${p.model}`} ok={!!status?.models.includes(p.model)} />
              {progress ? (
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between text-[12px]" style={{ color: C.sub }}>
                    <span>
                      {t("Downloading")} {progress.step}…
                    </span>
                    <span>{progress.total ? `${mb(progress.done)} / ${mb(progress.total)}` : mb(progress.done)}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full transition-[width]"
                      style={{
                        background: C.accent,
                        width: progress.total ? `${Math.min(100, (progress.done / progress.total) * 100)}%` : "30%",
                      }}
                    />
                  </div>
                </div>
              ) : needsDownload ? (
                <div className="flex items-center gap-2 text-[12px]" style={{ color: C.sub }}>
                  <Download size={14} />
                  {p.frameGeneration === "RIFE"
                    ? t("About 60 MB downloads once, the first time you turn it on.")
                    : t("A small download happens once, the first time you turn it on.")}
                </div>
              ) : null}
            </Card>
          </div>
        </div>

        <div className="flex items-center gap-3 px-5 py-3" style={{ borderTop: `1px solid ${C.cardEdge}` }}>
          <div className="min-w-0 flex-1 truncate text-[12px]" style={{ color: error ? "#ff9b9b" : C.sub }} title={error ?? ""}>
            {error ?? (status?.primeError ? status.primeError : "")}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-[5px] px-4 text-[14px] text-white hover:brightness-125"
            style={{ background: C.field, border: `1px solid ${C.fieldEdge}` }}
          >
            {t("Cancel")}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="h-9 rounded-[5px] px-5 text-[14px] font-semibold text-black hover:brightness-110 disabled:opacity-60"
            style={{ background: C.accent }}
          >
            {saving ? t("Applying…") : t("Save")}
          </button>
        </div>
      </div>
    </div>,
    host,
  );
}

function StatusLine({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between text-[13px]">
      <span style={{ color: C.text }}>{label}</span>
      <span className="font-semibold" style={{ color: ok ? "#9be29b" : C.sub }}>
        {ok ? "Ready" : "Not downloaded"}
      </span>
    </div>
  );
}
