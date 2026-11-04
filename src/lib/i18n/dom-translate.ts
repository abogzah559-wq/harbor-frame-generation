/**
 * Arabic for text written straight into the markup (not through t()).
 *
 * Used on the Settings page: every English text node, placeholder, tooltip
 * and aria-label that has an Arabic entry in the dictionary is swapped in
 * place, and kept swapped as React re-renders.
 */
import ar from "./locales/ar";
import { getUiLanguage } from "./store";

const ATTRS = ["placeholder", "title", "aria-label"] as const;

function lookup(raw: string): string | null {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text || !/[A-Za-z]/.test(text)) return null;
  const hit = ar[text];
  if (!hit || hit === text) return null;
  const lead = raw.match(/^\s*/)?.[0] ?? "";
  const trail = raw.match(/\s*$/)?.[0] ?? "";
  return lead + hit + trail;
}

function translateNode(node: Node) {
  if (node.nodeType === Node.TEXT_NODE) {
    const parent = node.parentElement;
    if (!parent || parent.closest("code, pre, textarea, [data-no-translate]")) return;
    const next = lookup(node.nodeValue ?? "");
    if (next != null) node.nodeValue = next;
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as Element;
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (v) {
      const next = lookup(v);
      if (next != null) el.setAttribute(a, next);
    }
  }
  if (el.matches("code, pre, textarea, [data-no-translate]")) return;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let n = walker.nextNode();
  while (n) {
    if (n.nodeType === Node.TEXT_NODE) translateNode(n);
    else {
      const e = n as Element;
      for (const a of ATTRS) {
        const v = e.getAttribute(a);
        if (v) {
          const next = lookup(v);
          if (next != null) e.setAttribute(a, next);
        }
      }
    }
    n = walker.nextNode();
  }
}

/** Keeps `root` translated while the UI language is Arabic. Returns a stop function. */
export function keepTranslated(root: HTMLElement): () => void {
  if (getUiLanguage() !== "ar") return () => {};
  translateNode(root);
  const mo = new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === "characterData") translateNode(m.target);
      else if (m.type === "attributes") translateNode(m.target);
      else m.addedNodes.forEach(translateNode);
    }
  });
  mo.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });
  return () => mo.disconnect();
}
