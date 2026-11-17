import { useEffect, useState } from "react";
import { Loader2, ShieldCheck, ShieldAlert } from "lucide-react";
import { useT } from "@/lib/i18n";
import { fastEngineGet, fastEngineSet, type FastEngineNet, type FastEngineState } from "@/lib/torrent/local-engine";
import { Section, ToggleRow } from "../shared";

const EMPTY_NET: FastEngineNet = {
  mode: "direct",
  socksHost: "",
  socksPort: 1080,
  socksUser: "",
  socksPass: "",
  wireguardConf: "",
  allowIpv6: false,
};

const MODES: Array<{ id: FastEngineNet["mode"]; label: string }> = [
  { id: "direct", label: "Direct" },
  { id: "socks5", label: "SOCKS5 proxy" },
  { id: "wireguard", label: "WireGuard" },
];

const inputCls =
  "h-10 w-full rounded-lg border border-edge-soft bg-canvas/60 px-3 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-subtle/60 focus:border-edge";

/** Fast streaming engine and its connection protection (SOCKS5 / WireGuard
 *  with a kill switch). */
export function FastEngineSection() {
  const t = useT();
  const [state, setState] = useState<FastEngineState | null>(null);
  const [net, setNet] = useState<FastEngineNet>(EMPTY_NET);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = () =>
      void fastEngineGet().then((s) => {
        if (!alive || !s) return;
        setState(s);
        setNet((prev) => (prev === EMPTY_NET ? { ...EMPTY_NET, ...s.net, mode: (s.net.mode || "direct") as FastEngineNet["mode"] } : prev));
      });
    load();
    const timer = window.setInterval(load, 4000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  if (!state) return null;

  const save = async (enabled: boolean, next: FastEngineNet) => {
    setSaving(true);
    setError(null);
    try {
      setState(await fastEngineSet(enabled, next));
      setSavedAt(Date.now());
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const status = state.status;
  const protectedMode = net.mode !== "direct";
  const stateText = !status
    ? state.enabled
      ? t("Starts with the next torrent you play")
      : t("Off")
    : status.state.kind === "connected"
      ? t("Protected: traffic goes through {endpoint}", { endpoint: status.endpoint ?? "" })
      : status.state.kind === "direct"
        ? t("Direct connection")
        : status.state.kind === "connecting"
          ? t("Connecting… traffic waits until the connection is verified")
          : t("Blocked by the kill switch: {reason}", { reason: status.state.reason ?? "" });

  return (
    <Section
      title={t("Fast streaming engine")}
      subtitle={t("Plays torrents the way a streaming service does: the moment you skip to is downloaded first, the next episode of a season pack downloads in the background, and the connection can go through a VPN.")}
    >
      <ToggleRow
        label={t("Use the fast engine")}
        sub={t("Starts and seeks faster, especially on large and 4K files. Frame generation works the same. Turn off to use the classic engine.")}
        value={state.enabled}
        onChange={(v) => void save(v, net)}
      />

      {state.enabled && (
        <div className="flex flex-col gap-3 pt-1">
          <span className="text-[13.5px] font-semibold text-ink">{t("Connection protection")}</span>
          <p className="text-[12px] leading-relaxed text-ink-subtle">
            {t("With SOCKS5 or WireGuard, torrent traffic only leaves through the proxy or tunnel. If it drops, the kill switch stops all torrent traffic instead of using your normal connection.")}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setNet({ ...net, mode: m.id })}
                className={`h-9 rounded-lg px-3.5 text-[12.5px] font-semibold transition-colors ${
                  net.mode === m.id ? "bg-ink text-canvas" : "border border-edge-soft text-ink-muted hover:border-edge hover:text-ink"
                }`}
              >
                {t(m.label)}
              </button>
            ))}
          </div>

          {net.mode === "socks5" && (
            <div className="grid grid-cols-[1fr_110px] gap-2">
              <input className={inputCls} dir="ltr" placeholder={t("Proxy host")} value={net.socksHost} onChange={(e) => setNet({ ...net, socksHost: e.target.value })} />
              <input
                className={inputCls}
                dir="ltr"
                inputMode="numeric"
                placeholder={t("Port")}
                value={net.socksPort || ""}
                onChange={(e) => setNet({ ...net, socksPort: Math.min(65535, Number(e.target.value.replace(/\D/g, "")) || 0) })}
              />
              <input className={inputCls} dir="ltr" placeholder={t("Username (optional)")} value={net.socksUser} onChange={(e) => setNet({ ...net, socksUser: e.target.value })} />
              <input
                className={inputCls}
                dir="ltr"
                type="password"
                placeholder={t("Password")}
                value={net.socksPass}
                onChange={(e) => setNet({ ...net, socksPass: e.target.value })}
              />
            </div>
          )}

          {net.mode === "wireguard" && (
            <textarea
              dir="ltr"
              spellCheck={false}
              rows={7}
              placeholder={t("Paste your WireGuard .conf file here ([Interface] and [Peer])")}
              value={net.wireguardConf}
              onChange={(e) => setNet({ ...net, wireguardConf: e.target.value })}
              className="w-full rounded-lg border border-edge-soft bg-canvas/60 p-3 font-mono text-[12px] text-ink outline-none focus:border-edge"
            />
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={saving}
              onClick={() => void save(true, net)}
              className="flex h-10 items-center gap-2 rounded-lg bg-accent px-5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              {t("Save connection")}
            </button>
            {savedAt > 0 && !saving && !error && <span className="text-[12px] text-emerald-400">{t("Saved")}</span>}
          </div>

          <div
            className={`flex items-start gap-2 rounded-lg px-3 py-2.5 text-[12.5px] ${
              status && !status.trafficAllowed ? "bg-red-500/10 text-red-300" : "bg-white/[0.04] text-ink-muted"
            }`}
          >
            {protectedMode && status?.trafficAllowed ? (
              <ShieldCheck size={15} className="mt-0.5 shrink-0 text-emerald-400" />
            ) : protectedMode ? (
              <ShieldAlert size={15} className="mt-0.5 shrink-0" />
            ) : null}
            <span>{stateText}</span>
          </div>
          {error && <p className="text-[12px] text-red-400">{error}</p>}
        </div>
      )}
    </Section>
  );
}
