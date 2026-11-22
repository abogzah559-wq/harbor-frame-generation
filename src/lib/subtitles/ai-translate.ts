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
import { googleTranslate } from "@/lib/arabic-meta";

export const GEMINI_KEY_URL = "https://aistudio.google.com/apikey";
export const TRANSLATE_EVENT = "harbor:ai-translate-sub";

/** Newest first. gemini-2.0-flash was shut down in June 2026 and
 *  gemini-2.5-flash only answers keys that used it before, so a new key
 *  needs a 3.x model. The first one that answers is remembered. */
const MODELS = [
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-flash-latest",
  "gemini-2.5-flash",
];
const MODEL_KEY = "harbor.ai-subs.model";
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

/** Keep reasoning short: subtitles need speed, not deliberation. */
function thinkingFor(model: string, on: boolean): Record<string, unknown> {
  if (!on) return {};
  if (model.startsWith("gemini-2.5")) return { thinkingConfig: { thinkingBudget: 0 } };
  if (model.startsWith("gemini-3")) return { thinkingConfig: { thinkingLevel: "low" } };
  return {};
}

async function gemini(
  key: string,
  model: string,
  lines: string[],
  context: string,
  thinking = true,
  system: string = SYSTEM,
): Promise<string[]> {
  const body = {
    systemInstruction: { parts: [{ text: system }] },
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
      ...thinkingFor(model, thinking),
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
  // skip any thought-summary parts; only the answer is JSON
  const parts: { text?: string; thought?: boolean }[] = json?.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .filter((p) => !p.thought)
    .map((p) => p.text ?? "")
    .join("")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  if (!text) throw Object.assign(new Error(json?.promptFeedback?.blockReason ? `blocked: ${json.promptFeedback.blockReason}` : "empty response"), { status: 0 });
  const out = JSON.parse(text);
  if (!Array.isArray(out)) throw new Error("bad response");
  return out.map((s) => String(s ?? ""));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function savedModel(): string | null {
  try {
    const m = localStorage.getItem(MODEL_KEY);
    return m && MODELS.includes(m) ? m : null;
  } catch {
    return null;
  }
}
let workingModel: string | null = savedModel();
function rememberModel(m: string) {
  workingModel = m;
  try {
    localStorage.setItem(MODEL_KEY, m);
  } catch {
    /* ignore */
  }
}

type ApiError = Error & { status?: number };
const isKeyProblem = (e: ApiError) =>
  e.status === 401 || /api key not valid|api_key_invalid|invalid api key|permission denied.*key/i.test(e.message);
const isModelProblem = (e: ApiError) =>
  e.status === 404 ||
  ((e.status === 400 || e.status === 403) && /model|not found|not supported|not available|no longer|deprecated/i.test(e.message));
const isThinkingProblem = (e: ApiError) => e.status === 400 && /thinking/i.test(e.message);

/** Calls the remembered model, or walks the list until one answers. */
async function callAnyModel(key: string, lines: string[], context: string, system: string = SYSTEM): Promise<string[]> {
  const order = workingModel ? [workingModel, ...MODELS.filter((m) => m !== workingModel)] : MODELS;
  let last: ApiError | null = null;
  for (const model of order) {
    try {
      let out: string[];
      try {
        out = await gemini(key, model, lines, context, true, system);
      } catch (e) {
        if (!isThinkingProblem(e as ApiError)) throw e;
        out = await gemini(key, model, lines, context, false, system);
      }
      if (workingModel !== model) rememberModel(model);
      return out;
    } catch (e) {
      const err = e as ApiError;
      if (isKeyProblem(err)) throw Object.assign(new Error("bad-key"), { status: err.status });
      if (!isModelProblem(err)) throw err;
      last = err;
    }
  }
  throw last ?? new Error("no-model");
}

async function translateBatch(key: string, lines: string[], context: string): Promise<string[]> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const out = await callAnyModel(key, lines, context);
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
      lastError = e;
      const err = e as ApiError;
      if (err.message === "bad-key" || err.message === "no-model" || isModelProblem(err)) throw e;
      if (err.status === 400 || err.status === 403) throw e;
      await sleep(err.status === 429 ? 8000 * (attempt + 1) : 1500 * (attempt + 1));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("translation failed");
}

const clean = (t: string) => t.replace(/\{\\[^}]*\}/g, "").replace(/<[^>]+>/g, "").trim();

/** Lines that start right where you are, so the first Arabic shows in a second. */
const FIRST_LOOK = 40;
const LINE_BREAK_MARK = " ¶ ";

/**
 * Free Google Translate for a block of lines (no key needed). Used to show
 * Arabic straight away, and as the whole translation when there's no Gemini key.
 */
async function googleBatch(lines: string[]): Promise<string[]> {
  const out: string[] = new Array(lines.length).fill("");
  const flat = lines.map((l) => l.replace(/\s*\n\s*/g, LINE_BREAK_MARK));
  const chunks: number[][] = [];
  let cur: number[] = [];
  let size = 0;
  flat.forEach((l, i) => {
    if (cur.length > 0 && size + l.length > 1500) {
      chunks.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(i);
    size += l.length + 1;
  });
  if (cur.length) chunks.push(cur);
  const restore = (t: string) => t.replace(/\s*¶\s*/g, "\n").trim();
  await Promise.all(
    chunks.map(async (idx) => {
      const joined = idx.map((i) => flat[i]).join("\n");
      const tr = await googleTranslate(joined, "ar");
      const parts = tr ? tr.split("\n") : [];
      if (parts.length === idx.length) {
        idx.forEach((i, k) => (out[i] = restore(parts[k])));
        return;
      }
      // Lines got merged: translate them one by one instead.
      for (const i of idx) {
        const one = await googleTranslate(flat[i], "ar");
        out[i] = one ? restore(one) : lines[i];
      }
    }),
  );
  return out.map((t, i) => t || lines[i]);
}

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
  const useGemini = !!opts.key?.trim();
  running = true;
  set({ status: "extracting", progress: 0, error: null });
  try {
    const res = await getCuesAnySource(opts.bridge, opts.sourceUrl, opts.headers, 600);
    if (!res.ok) throw new Error(res.reason);
    const cues = res.source.cues.filter((c) => clean(c.text));
    if (!cues.length) throw new Error("no-cues");

    const fingerprint = hash(
      `${useGemini ? "gemini" : "google"}|${opts.cacheId}|${cues.length}|${cues.slice(0, 5).map((c) => c.text).join("|")}`,
    );
    const index = readIndex();
    if (index[fingerprint]) {
      const ok = await opts.bridge.addSubtitle(index[fingerprint], "ar", useGemini ? "العربية (Gemini)" : "العربية (Google)", true);
      if (ok) {
        set({ status: "done", progress: 1 });
        return;
      }
    }

    set({ status: "translating", progress: 0 });
    const out: string[] = cues.map(() => "");
    const at = getPlaybackPosition();
    const order = batchOrder(cues, at);
    let done = 0;
    let loadedEarly = false;
    let next = 0;
    const name = `ai-ar-${fingerprint}`;
    const snapshot = () =>
      toSrt(cues.map((c, i) => ({ ...c, text: out[i] || clean(c.text) })));

    // First look: the next lines from where you are, through free Google
    // Translate, on screen within a second or two. Gemini then replaces them.
    const startIdx = Math.max(0, cues.findIndex((c) => c.end >= at));
    const firstIdx = Array.from({ length: Math.min(FIRST_LOOK, cues.length - startIdx) }, (_, k) => startIdx + k);
    const quick = await googleBatch(firstIdx.map((i) => clean(cues[i].text))).catch(() => null);
    const quickOut: string[] = cues.map(() => "");
    if (quick) {
      firstIdx.forEach((i, k) => (quickOut[i] = quick[k]));
      const p = await writeSrt(
        toSrt(cues.map((c, i) => ({ ...c, text: quickOut[i] || clean(c.text) }))),
        `${name}-first`,
      );
      if (p) await opts.bridge.addSubtitle(p, "ar", "العربية …", true);
    }

    const translateBlock = (lines: string[]) =>
      useGemini
        ? translateBatch(opts.key, lines, opts.title).catch((e: ApiError) => {
            // A Gemini problem mid-way (quota, bad key) must not leave English:
            // fall back to Google for the rest.
            if (e?.message === "bad-key" || e?.status === 429 || e?.message === "no-model") return googleBatch(lines);
            throw e;
          })
        : googleBatch(lines);

    const worker = async () => {
      while (next < order.length) {
        const block = order[next++];
        const lines = block.map((i) => clean(cues[i].text));
        const tr = await translateBlock(lines);
        block.forEach((i, k) => (out[i] = tr[k]?.trim() || lines[k]));
        done += block.length;
        set({ progress: done / cues.length });
        // show Arabic as soon as the part you're watching is ready
        if (!loadedEarly && order[0].every((i) => out[i])) {
          loadedEarly = true;
          const p = await writeSrt(snapshot(), `${name}-partial`);
          if (p) await opts.bridge.addSubtitle(p, "ar", useGemini ? "العربية (Gemini) …" : "العربية …", true);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, order.length) }, worker));

    const path = await writeSrt(snapshot(), name);
    if (!path) throw new Error("save-failed");
    await opts.bridge.addSubtitle(path, "ar", useGemini ? "العربية (Gemini)" : "العربية (Google)", true);
    writeIndex({ ...readIndex(), [fingerprint]: path });
    set({ status: "done", progress: 1 });
  } catch (e) {
    set({ status: "error", error: e instanceof Error ? e.message : String(e) });
  } finally {
    running = false;
  }
}

const SYNOPSIS_SYSTEM = `You translate film, series and anime synopses into natural, fluent Modern Standard Arabic.
Keep the meaning and tone, write names in Arabic letters as Arab fans know them, and keep it about the same length.
Never add notes or quotes. Return a JSON array with exactly one string: the Arabic synopsis.`;
const SYNOPSIS_KEY = "harbor.ai-synopsis.v1";

/** One synopsis in Arabic, cached on disk by its text. Null when there is
 *  no key or the request fails; callers keep the original text then. */
export async function translateSynopsisToArabic(key: string, text: string, title = ""): Promise<string | null> {
  const src = text.trim();
  if (!key || !src) return null;
  const id = hash(src);
  let store: Record<string, string> = {};
  try {
    store = JSON.parse(localStorage.getItem(SYNOPSIS_KEY) ?? "{}");
  } catch {
    store = {};
  }
  if (store[id]) return store[id];
  try {
    const [ar] = await callAnyModel(key, [src], title, SYNOPSIS_SYSTEM);
    const out = (ar ?? "").trim();
    if (!out) return null;
    store[id] = out;
    const entries = Object.entries(store).slice(-300);
    try {
      localStorage.setItem(SYNOPSIS_KEY, JSON.stringify(Object.fromEntries(entries)));
    } catch {
      /* ignore */
    }
    return out;
  } catch {
    return null;
  }
}
