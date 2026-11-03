/**
 * Translates the subtitle you're watching (embedded or loaded, any language)
 * into natural, high-quality Arabic with Google Gemini, then loads it into
 * the player. Whole blocks are sent at once so names and context stay
 * consistent; finished translations are kept on disk and reused.
 */
import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PlayerBridge } from "@/lib/player/bridge";
import { getPlaybackPosition } from "@/lib/player/playback-clock";
import { getCuesAnySource } from "./extract";
import type { SubCue } from "./parser";
import { toSrt } from "./serialize";

export const GEMINI_KEY_URL = "https://aistudio.google.com/apikey";
export const TRANSLATE_EVENT = "harbor:ai-translate-sub";

const MODEL = "gemini-2.5-flash";
const FALLBACK_MODEL = "gemini-2.0-flash";
const BATCH = 90;
const PARALLEL = 2;
const INDEX_KEY = "harbor.ai-subs.v1";

export type TranslateStatus = "idle" | "extracting" | "translating" | "done" | "error";
export type TranslateState = { status: TranslateStatus; progress: number; error: string | null };

let state: TranslateState = { status: "idle", progress: 0, error: null };
const listeners = new Set<() => void>();
function set(next: Partial<TranslateState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}
export function useAiTranslateState(): TranslateState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}
export function resetAiTranslate() {
  if (state.status !== "extracting" && state.status !== "translating") set({ status: "idle", progress: 0, error: null });
}

type HarborFetchResponse = { status: number; ok: boolean; body: string };

const SYSTEM = `You are a professional Arabic subtitle translator for films, series and anime.
Translate every subtitle line into natural, fluent Modern Standard Arabic as a skilled human subtitler would:
- Convey meaning, tone and emotion, not word-for-word; idioms become natural Arabic equivalents.
- Keep it concise and easy to read on screen.
- Keep character names, places and recurring terms consistent; write names in Arabic letters as commonly known.
- Keep honorifics and attack/technique names in anime the way Arab fans know them when there is a common form.
- Preserve line breaks inside a line where they help reading. Drop formatting tags like {\\an8} or <i>.
- Never add notes, explanations, or quotes. Never merge or split lines.
Return a JSON array of strings with exactly the same number of items, in the same order as the input.`;

async function gemini(key: string, model: string, lines: string[], context: string): Promise<string[]> {
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [
      {
        role: "user",
        parts: [
          {
            text:
              (context ? `Title: ${context}\n` : "") +
              `Translate these ${lines.length} subtitle lines to Arabic. Input JSON array:\n` +
              JSON.stringify(lines),
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.3,
      responseMimeType: "application/json",
      responseSchema: { type: "ARRAY", items: { type: "STRING" } },
      ...(model.startsWith("gemini-2.5") ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
    },
  };
  const res = await invoke<HarborFetchResponse>("harbor_fetch", {
    args: {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
      timeoutMs: 120_000,
    },
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      msg = JSON.parse(res.body)?.error?.message ?? msg;
    } catch {
      /* keep status */
    }
    const err = new Error(msg) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  const json = JSON.parse(res.body);
  const text: string = json?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
  const out = JSON.parse(text);
  if (!Array.isArray(out)) throw new Error("bad response");
  return out.map((s) => String(s ?? ""));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function translateBatch(key: string, lines: string[], context: string): Promise<string[]> {
  let model = MODEL;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const out = await gemini(key, model, lines, context);
      if (out.length === lines.length) return out;
      // wrong count: split the block and try the halves
      if (lines.length > 8) {
        const mid = Math.ceil(lines.length / 2);
        const [a, b] = await Promise.all([
          translateBatch(key, lines.slice(0, mid), context),
          translateBatch(key, lines.slice(mid), context),
        ]);
        return [...a, ...b];
      }
    } catch (e) {
      const status = (e as { status?: number }).status ?? 0;
      if (status === 400 || status === 401 || status === 403) throw e;
      if (status === 404) model = FALLBACK_MODEL;
      await sleep(status === 429 ? 8000 * (attempt + 1) : 1500 * (attempt + 1));
    }
  }
  throw new Error("translation failed");
}

const clean = (t: string) => t.replace(/\{\\[^}]*\}/g, "").replace(/<[^>]+>/g, "").trim();

/** Order blocks so the part you're watching is translated first. */
function batchOrder(cues: SubCue[], at: number): number[][] {
  const blocks: number[][] = [];
  for (let i = 0; i < cues.length; i += BATCH) blocks.push(Array.from({ length: Math.min(BATCH, cues.length - i) }, (_, k) => i + k));
  const startIdx = Math.max(0, cues.findIndex((c) => c.end >= at));
  const first = Math.floor(startIdx / BATCH);
  return [...blocks.slice(first), ...blocks.slice(0, first)];
}

function readIndex(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(INDEX_KEY) ?? "{}");
  } catch {
    return {};
  }
}
function writeIndex(idx: Record<string, string>) {
  try {
    const entries = Object.entries(idx).slice(-200);
    localStorage.setItem(INDEX_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* ignore */
  }
}

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h.toString(36);
}

async function writeSrt(text: string, name: string): Promise<string | null> {
  try {
    const pathMod = await import("@tauri-apps/api/path");
    const dir = await pathMod.join(await pathMod.appCacheDir(), "ai-subs");
    const filePath = await pathMod.join(dir, `${name}.srt`);
    await invoke("save_text_file", { path: filePath, contents: text });
    return filePath;
  } catch {
    return null;
  }
}

let running = false;

export async function translateCurrentSubtitle(opts: {
  bridge: PlayerBridge;
  key: string;
  sourceUrl: string | null;
  headers?: Record<string, string>;
  title: string;
  cacheId: string;
}): Promise<void> {
  if (running) return;
  if (!opts.key) {
    set({ status: "error", progress: 0, error: "no-key" });
    return;
  }
  running = true;
  set({ status: "extracting", progress: 0, error: null });
  try {
    const res = await getCuesAnySource(opts.bridge, opts.sourceUrl, opts.headers, 600);
    if (!res.ok) throw new Error(res.reason);
    const cues = res.source.cues.filter((c) => clean(c.text));
    if (!cues.length) throw new Error("no-cues");

    const fingerprint = hash(`${opts.cacheId}|${cues.length}|${cues.slice(0, 5).map((c) => c.text).join("|")}`);
    const index = readIndex();
    if (index[fingerprint]) {
      const ok = await opts.bridge.addSubtitle(index[fingerprint], "ar", "العربية (Gemini)", true);
      if (ok) {
        set({ status: "done", progress: 1 });
        return;
      }
    }

    set({ status: "translating", progress: 0 });
    const out: string[] = cues.map(() => "");
    const order = batchOrder(cues, getPlaybackPosition());
    let done = 0;
    let loadedEarly = false;
    let next = 0;
    const name = `ai-ar-${fingerprint}`;
    const snapshot = () =>
      toSrt(cues.map((c, i) => ({ ...c, text: out[i] || clean(c.text) })));

    const worker = async () => {
      while (next < order.length) {
        const block = order[next++];
        const lines = block.map((i) => clean(cues[i].text));
        const tr = await translateBatch(opts.key, lines, opts.title);
        block.forEach((i, k) => (out[i] = tr[k]?.trim() || lines[k]));
        done += block.length;
        set({ progress: done / cues.length });
        // show Arabic as soon as the part you're watching is ready
        if (!loadedEarly && order[0].every((i) => out[i])) {
          loadedEarly = true;
          const p = await writeSrt(snapshot(), `${name}-partial`);
          if (p) await opts.bridge.addSubtitle(p, "ar", "العربية (Gemini) …", true);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, order.length) }, worker));

    const path = await writeSrt(snapshot(), name);
    if (!path) throw new Error("save-failed");
    await opts.bridge.addSubtitle(path, "ar", "العربية (Gemini)", true);
    writeIndex({ ...readIndex(), [fingerprint]: path });
    set({ status: "done", progress: 1 });
  } catch (e) {
    set({ status: "error", error: e instanceof Error ? e.message : String(e) });
  } finally {
    running = false;
  }
}
