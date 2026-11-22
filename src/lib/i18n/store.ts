import { useSyncExternalStore } from "react";
import { isRtl, type UiLanguage } from "./languages";

let current: UiLanguage = "ar";
const listeners = new Set<() => void>();

function applyDocument(lang: UiLanguage) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dir = isRtl(lang) ? "rtl" : "ltr";
  root.lang = lang;
}

export function getUiLanguage(): UiLanguage {
  return current;
}

export function setUiLanguage(_lang: UiLanguage): void {
  // Arabic only: whatever was saved before, the app runs in Arabic.
  const next: UiLanguage = "ar";
  applyDocument(next);
  if (next === current) return;
  current = next;
  for (const l of listeners) l();
}

export function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useUiLanguage(): UiLanguage {
  return useSyncExternalStore(subscribe, getUiLanguage, getUiLanguage);
}
