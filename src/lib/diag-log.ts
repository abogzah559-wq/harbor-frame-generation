import { invoke } from "@tauri-apps/api/core";
import { isWindowsDesktop } from "@/lib/platform";

/** Mirrors tagged console lines ("[player] …", "[mpv] …", "[boost] …") into
 *  %LOCALAPPDATA%\app.harbor\boost\player-log.txt so playback issues can be diagnosed. */
let buf: string[] = [];
let timer: number | null = null;

function flush() {
  timer = null;
  if (!buf.length) return;
  const lines = buf;
  buf = [];
  invoke("boost_log", { lines }).catch(() => {});
}

export function diag(...parts: unknown[]) {
  const ts = new Date().toISOString().slice(11, 23);
  const text = parts
    .map((p) => {
      if (typeof p === "string") return p;
      try {
        return JSON.stringify(p);
      } catch {
        return String(p);
      }
    })
    .join(" ");
  buf.push(`${ts} ${text}`.slice(0, 2000));
  if (timer == null) timer = window.setTimeout(flush, 800);
}

export function installDiagLog() {
  if (!isWindowsDesktop()) return;
  for (const level of ["log", "warn", "error"] as const) {
    const orig = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      orig(...args);
      const first = args[0];
      if (level === "error" || (typeof first === "string" && /^\[(player|mpv|boost|resume)/.test(first))) {
        diag(level.toUpperCase(), ...args);
      }
    };
  }
  diag("[diag] Harbor started");
}
