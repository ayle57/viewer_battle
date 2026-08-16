/**
 * The one shared fact about whether PageChangeCurtain.tsx is currently
 * covering the screen — a plain module-level singleton (not React
 * context) because the two sides that care about it, PageChangeCurtain
 * itself and every `useScrollReveal` consumer, don't share a common
 * ancestor worth threading a provider through, and there's only ever one
 * curtain on screen at a time.
 *
 * Exists for exactly one reason: an `IntersectionObserver` doesn't know
 * or care that a full-viewport overlay is covering its target — an
 * element sitting inside the first screenful (a short window, a tall
 * zoom level, a section right below the fold) crosses `useScrollReveal`'s
 * threshold the instant it mounts, while the curtain is still covering
 * it. Without this, that reveal finishes playing entirely behind the
 * curtain — by the time the curtain lifts, the section is already sitting
 * in its final "shown" state with no visible entrance at all. Same
 * failure mode CURTAIN_TOTAL_SECONDS exists to fix for CinematicHero's
 * unconditional cold-open (see curtainTiming.ts) — this is the
 * IntersectionObserver-driven equivalent, where a fixed delay can't work
 * because the element might not scroll into view until long after the
 * curtain is gone.
 */
type Listener = () => void;

let active = false;
const listeners = new Set<Listener>();

export function setCurtainActive(next: boolean) {
  if (active === next) return;
  active = next;
  listeners.forEach((listener) => listener());
}

export function isCurtainActive() {
  return active;
}

export function subscribeCurtainActive(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
