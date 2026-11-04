/**
 * Thmanyah everywhere (when it's installed on this PC).
 *
 * The font isn't shipped with Harbor; if Windows has it, every piece of text
 * in the app (titles, menus, settings, the Harbor name at the top) switches
 * to it. Pictures (title logos, covers) are images and stay as they are.
 * Without the font installed nothing changes.
 */

const CANDIDATES = [
  "Thmanyah Sans",
  "ThmanyahSans",
  "thmanyahsans",
  "Thmanyah",
  "Thmanyah Serif Text",
  "Thmanyah Serif Display",
];

/** Compare text widths against two generic fallbacks: an installed font
 *  changes at least one of them. */
function installed(name: string): boolean {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  const sample = "مرحبا بالعالم Harbor 0123 wmWMlli";
  for (const base of ["monospace", "serif"]) {
    ctx.font = `48px ${base}`;
    const ref = ctx.measureText(sample).width;
    ctx.font = `48px "${name}", ${base}`;
    if (Math.abs(ctx.measureText(sample).width - ref) > 0.5) return true;
  }
  return false;
}

export function applyUserFont(): void {
  if (typeof document === "undefined") return;
  const name = CANDIDATES.find(installed);
  if (!name) return;
  const style = document.createElement("style");
  style.id = "harbor-user-font";
  // high specificity + !important: themes set their own fonts with !important
  style.textContent = `
:root { --harbor-user-font: "${name}"; }
html[data-user-font] body,
html[data-user-font] body *:not(code):not(pre):not(kbd):not(samp):not(.font-mono):not(svg):not(svg *) {
  font-family: "${name}", var(--font-sans) !important;
}
html[data-user-font] body .font-mono, html[data-user-font] body code, html[data-user-font] body pre {
  font-family: var(--font-mono) !important;
}`;
  document.head.appendChild(style);
  document.documentElement.setAttribute("data-user-font", name);
}
