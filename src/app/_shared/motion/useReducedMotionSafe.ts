"use client";

import { useSyncExternalStore } from "react";
import { useReducedMotion } from "motion/react";

/** Never actually changes — there's nothing to subscribe to, `useSyncExternalStore` just needs a stable no-op here. */
function subscribe() {
  return () => {};
}
function getClientSnapshot() {
  return true;
}
function getServerSnapshot() {
  return false;
}

/**
 * The hydration-safe version of motion/react's own `useReducedMotion` —
 * see PageTransition.tsx's doc comment (and this app's own memory on the
 * useScrollReveal SSR fix) for the exact bug this closes: the server has
 * no media query to read, so it always renders as if reduced motion is
 * OFF. A client whose OS preference is ALREADY "reduce" resolves the raw
 * hook synchronously on its very first render too (unlike a preference
 * that only changes later, which merely updates after mount) — so any
 * component that feeds the raw value straight into a `motion.*` prop, a
 * variant's distance, or a render branch disagrees with the server
 * before hydration ever gets a chance to reconcile. Confirmed via a real
 * Playwright run with `reducedMotion: "reduce"` already active — a
 * genuine, reproducible hydration mismatch (React tears down and
 * regenerates the whole subtree), not a theoretical one; this was found
 * across more than twenty components (`grep -rl useReducedMotion`), the
 * same root cause everywhere.
 *
 * Always resolves `false` for the server render AND the client's first
 * render, no matter what the OS preference actually is — the real value
 * only takes effect starting the NEXT render, an ordinary post-hydration
 * update rather than a mismatch. Every component reading reduced-motion
 * to affect what it renders should call this instead of the raw hook
 * (motion/react's own transition-only usages, e.g. a plain
 * `transition={{ duration: reduced ? 0 : 0.3 }}` with no structural or
 * style-value branching, are lower risk, but this hook costs nothing
 * extra to use everywhere for one consistent rule).
 */
export function useReducedMotionSafe(): boolean {
  const reduced = useReducedMotion() ?? false;
  // `useSyncExternalStore`, not a `useState` + `useEffect(() => setState(true))`
  // pair — this IS the pattern React itself recommends for "is this the
  // server render / the client's first (hydrating) render, or a real
  // client render" (there's genuinely nothing to subscribe to, `mounted`
  // only ever flips once): `getServerSnapshot` answers `false` for BOTH
  // the server render and the client's hydrating first pass (React
  // deliberately reads `getServerSnapshot` during hydration specifically
  // to guarantee that first-pass match), then React itself schedules the
  // follow-up render that switches to the real `getSnapshot` — no manual
  // effect, no lint complaint about a cascading setState-in-effect.
  const mounted = useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
  return mounted && reduced;
}
