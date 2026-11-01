/**
 * Smooth mouse-wheel scrolling for every scrollable page.
 *
 * A mouse wheel moves a page in fixed jumps (about 100 px per notch), which
 * looks like stutter on a fast screen. Here each notch moves a target and the
 * page glides to it over a few frames, easing out. Touchpads already send
 * small, continuous steps and are left alone, as are text fields, zoom
 * (Ctrl + wheel) and sideways scrolling.
 */

type Glide = { target: number; last: number; raf: number; behavior: string };

const glides = new WeakMap<HTMLElement, Glide>();

/** How much of the remaining distance is covered per 60 Hz frame. */
const EASE = 0.18;

function scrollableY(el: HTMLElement, dy: number): boolean {
  const style = getComputedStyle(el);
  if (style.overflowY !== "auto" && style.overflowY !== "scroll") return false;
  if (el.scrollHeight <= el.clientHeight + 1) return false;
  return dy > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0;
}

function findScroller(start: EventTarget | null, dy: number): HTMLElement | null {
  let el = start instanceof Element ? start : null;
  while (el && el !== document.documentElement) {
    if (el instanceof HTMLElement) {
      if (el.closest("input, textarea, select, [contenteditable='true'], [data-native-scroll]")) return null;
      if (scrollableY(el, dy)) return el;
    }
    el = el.parentElement;
  }
  return null;
}

function step(el: HTMLElement, g: Glide, prevTime: number) {
  g.raf = requestAnimationFrame((now) => {
    // frame-rate independent easing (same feel at 60, 144 or 240 Hz)
    const dt = Math.min(64, now - prevTime || 16.7);
    const k = 1 - Math.pow(1 - EASE, dt / 16.7);
    const cur = el.scrollTop;
    // someone else moved the page (scrollbar drag, code): follow them
    if (Math.abs(cur - g.last) > 2) g.target += cur - g.last;
    const max = el.scrollHeight - el.clientHeight;
    g.target = Math.max(0, Math.min(max, g.target));
    const diff = g.target - cur;
    if (Math.abs(diff) < 0.5) {
      el.scrollTop = g.target;
      g.last = el.scrollTop;
      g.raf = 0;
      el.style.scrollBehavior = g.behavior;
      return;
    }
    // at least a whole pixel per frame: scrollTop can round small steps away
    const move = Math.abs(diff) <= 1 ? diff : Math.sign(diff) * Math.max(1, Math.abs(diff * k));
    el.scrollTop = cur + move;
    g.last = el.scrollTop;
    step(el, g, now);
  });
}

function onWheel(e: WheelEvent) {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
  if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
  // lines (some mice) to pixels; touchpads send small pixel steps: leave them
  const dy = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * 600 : e.deltaY;
  if (e.deltaMode === 0 && Math.abs(dy) < 40) return;
  const el = findScroller(e.target, dy);
  if (!el) return;
  e.preventDefault();
  let g = glides.get(el);
  if (!g || !g.raf) {
    // CSS smooth scrolling would fight the per-frame steps: off while gliding
    g = { target: el.scrollTop, last: el.scrollTop, raf: 0, behavior: el.style.scrollBehavior };
    el.style.scrollBehavior = "auto";
    glides.set(el, g);
  }
  g.target += dy;
  if (!g.raf) step(el, g, performance.now());
}

let installed = false;

export function installSmoothWheel(): void {
  if (installed || typeof window === "undefined") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  installed = true;
  window.addEventListener("wheel", onWheel, { passive: false, capture: true });
}
