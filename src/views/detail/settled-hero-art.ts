import { useEffect, useRef, useState } from "react";

/** The backdrop, logo and title a title page shows. They are chosen once,
 *  when the page's details have loaded, and never swapped afterwards: the
 *  sources answer at different times, and showing each answer as it came in
 *  made the picture and the title change several times on screen. */
export type HeroArt = { backdrop?: string; logo?: string; title: string };

/** Wide enough to stay sharp on a full-width 1080p hero. */
const MIN_WIDTH = 1920;
/** Longest wait for the details before choosing from what is there. */
const SETTLE_MS = 1500;
/** Longest wait for one candidate image to report its size. */
const PROBE_MS = 4000;

const chosen = new Map<string, HeroArt>();

const toOriginal = (url: string) => url.replace(/\/t\/p\/w\d+\//, "/t/p/original/");

function probeWidth(url: string): Promise<number> {
  return new Promise((resolve) => {
    const img = new Image();
    let done = false;
    const finish = (w: number) => {
      if (done) return;
      done = true;
      resolve(w);
    };
    const timer = window.setTimeout(() => finish(0), PROBE_MS);
    img.decoding = "async";
    img.onload = () => {
      window.clearTimeout(timer);
      finish(img.naturalWidth);
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      finish(0);
    };
    img.src = url;
  });
}

/** First candidate (in priority order) that is at least MIN_WIDTH wide;
 *  otherwise the widest one that loaded. Tried one at a time, so usually
 *  only the image that ends up on screen is downloaded. */
async function pickBackdrop(candidates: string[]): Promise<string | undefined> {
  const list = [...new Set(candidates.filter(Boolean).map(toOriginal))].slice(0, 4);
  let best: { url: string; width: number } | null = null;
  for (const url of list) {
    const width = await probeWidth(url);
    if (width >= MIN_WIDTH) return url;
    if (width > 0 && (!best || width > best.width)) best = { url, width };
  }
  return best?.url;
}

export function useSettledHeroArt({
  id,
  ready,
  candidates,
  logo,
  title,
  pinned,
}: {
  id: string;
  /** The page's details have loaded (or there is nothing more to wait for). */
  ready: boolean;
  /** Backdrop candidates, best first. */
  candidates: (string | undefined | null)[];
  logo?: string;
  title: string;
  /** A backdrop the user pinned always wins and may change at any time. */
  pinned?: string;
}): HeroArt | null {
  const [art, setArt] = useState<HeroArt | null>(() => chosen.get(id) ?? null);
  const [timedOut, setTimedOut] = useState(false);
  const currentId = useRef(id);
  currentId.current = id;
  const inFlight = useRef<Set<string>>(new Set());
  const latest = useRef({ candidates, logo, title });
  latest.current = { candidates, logo, title };

  useEffect(() => {
    setArt(chosen.get(id) ?? null);
    setTimedOut(false);
    const timer = window.setTimeout(() => setTimedOut(true), SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [id]);

  const hasCandidate = candidates.some(Boolean);
  useEffect(() => {
    const done = chosen.get(id);
    if (done) {
      setArt((prev) => (prev === done ? prev : done));
      return;
    }
    if (inFlight.current.has(id)) return;
    if (!ready && !(timedOut && hasCandidate)) return;
    inFlight.current.add(id);
    const snap = latest.current;
    void pickBackdrop(snap.candidates.filter((c): c is string => !!c)).then((backdrop) => {
      inFlight.current.delete(id);
      const now = currentId.current === id ? latest.current : snap;
      // The title and logo are the ones on hand when the choice was made;
      // a logo that only arrived while the images were measured fills in.
      const next: HeroArt = { backdrop, logo: snap.logo ?? now.logo, title: snap.title || now.title };
      chosen.set(id, next);
      if (currentId.current === id) setArt(next);
    });
  }, [id, ready, timedOut, hasCandidate]);

  if (pinned) return { ...(art ?? { title, logo }), backdrop: toOriginal(pinned) };
  return art;
}
