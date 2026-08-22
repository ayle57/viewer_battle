"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { useReducedMotionSafe } from "@/app/_shared/motion/useReducedMotionSafe";
import { LetterReveal } from "@/app/_shared/motion/LetterReveal";
import { EASE_OUT_EXPO } from "@/app/_shared/motion/variants";
import { CURTAIN_HOLD_MS, CURTAIN_IRIS_SECONDS } from "@/app/_shared/motion/curtainTiming";
import { setCurtainActive } from "@/app/_shared/motion/curtainState";
import styles from "./PageChangeCurtain.module.css";

// The choreography budget, all in one place so the beats below read as a
// timeline rather than magic numbers scattered through the JSX:
//   0ms        curtain starts closing (iris wipe covers the viewport)
//   ~150ms     letters start their blur-and-rise stagger
//   ~420ms     curtain fully closed; sweep bar starts drawing under the wordmark
//   ~900ms     HOLD_MS — curtain starts opening back up (iris wipe uncovers)
//   ~1300ms    fully gone
// Comfortably inside that window at every step, never racing it — the
// letters and the bar are always finished settling before the curtain
// starts opening again. Both constants live in curtainTiming.ts, not
// here — CinematicHero.tsx's own cold-open needs the exact same numbers
// to delay its start until this curtain has actually lifted (see that
// file's doc comment), so there's one shared source instead of two
// copies that can drift apart.
const HOLD_MS = CURTAIN_HOLD_MS;
const IRIS_DURATION = CURTAIN_IRIS_SECONDS;

/**
 * The "screen de changement de page" — a full-viewport branded stinger on
 * every real client-side route change, layered on top of
 * PageTransition.tsx's own slide (the two are meant to be felt together:
 * the outgoing page slides left as this curtain irises shut over it, the
 * wordmark builds itself letter by letter, then both clear onto the new
 * page already settled underneath). `usePathname()` changing is the main
 * trigger — never shown on a cold load of any OTHER route (nothing to
 * transition FROM yet), except `/` itself: landing there fresh (a typed
 * URL, a hard refresh, an external link) plays the curtain once too, as
 * the show's own opening beat rather than a change between two pages —
 * baked into `active`'s initial state below, not an effect, so it's
 * already the first thing painted rather than a flash-of-homepage-then-
 * curtain. Never shown under reduced motion (a full-screen flash is
 * exactly what that preference exists to suppress; PageTransition's own
 * reduced-motion path already renders the new page instantly).
 *
 * The iris itself is a `clip-path: circle()` wipe rather than a plain
 * opacity fade — closing in from a point to fully cover the screen, then
 * reversing to open back up — because a fade reads as "loading spinner,"
 * while a wipe reads as an intentional scene change (the broadcast
 * bumper this is meant to evoke). The wordmark uses `LetterReveal`
 * (src/app/_shared/motion/LetterReveal.tsx) — the same typography-arrival
 * primitive CinematicHero's hero wordmark now uses — so the loader and
 * the homepage read as one motion vocabulary, not two different ideas of
 * "stylish."
 *
 * The `HOLD_MS` hold is a plain `setTimeout` — legitimate here for the
 * same reason SessionCodeBadge's "Copied!" reset and
 * GameStartingSequence's countdown beats are: it only decides how long a
 * purely cosmetic overlay stays on screen, never a stand-in for real
 * app/session/game state (which stays exactly whatever it already was
 * underneath, untouched).
 */
export function PageChangeCurtain() {
  const pathname = usePathname();
  const reduced = useReducedMotionSafe(); // hydration-safe — see that hook's own doc comment
  // Compared against the PREVIOUS RENDER's own committed value, during
  // render — React's documented "adjusting state when a prop changes"
  // pattern, not an effect (so there's nothing here for
  // `react-hooks/set-state-in-effect` to flag: this isn't a subscription
  // to an external system, it's noticing this render's `pathname` differs
  // from last render's). Starting equal to the initial pathname means the
  // curtain never shows on a cold load of any route via this path.
  const [prevPathname, setPrevPathname] = useState(pathname);
  // The one exception: a cold load that's already ON `/` arms `active`
  // from its very first render via this lazy initializer — not an
  // effect, so it's part of the same render that produces the first
  // paint, not a setState firing a beat later.
  const [active, setActive] = useState(() => !reduced && pathname === "/");
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    if (!reduced) setActive(true);
  }

  useEffect(() => {
    if (!active) return;
    const timeout = setTimeout(() => setActive(false), HOLD_MS);
    return () => clearTimeout(timeout);
  }, [active]);

  // The visitor can't scroll the page out from under the curtain while
  // it's covering the screen — a full-viewport overlay that lets scroll
  // through underneath would let someone arrive mid-scroll the instant
  // it lifts, which reads as broken. Pure DOM side effect, no React
  // state — same "synchronize with an external system" shape as
  // CinematicHero's pointer-spotlight effect, nothing here for
  // `react-hooks/set-state-in-effect` to flag.
  //
  // This effect only ever publishes `true` to curtainState.ts, the
  // instant `active` does — going the other way is `onExitComplete`'s
  // job below, not this effect's. `active` flips to `false` at the
  // START of the curtain's exit wipe (the HOLD_MS timeout above), not
  // when the wipe finishes actually uncovering the screen — publishing
  // `false` here, keyed on `active`, told every `useScrollReveal`
  // consumer it was safe to reveal ~`IRIS_DURATION` (420ms) too early,
  // so the whole entrance animation played out UNDER the still-closing
  // curtain and was never actually seen. `onExitComplete` fires once
  // Framer Motion's own exit transition genuinely finishes — the curtain
  // is verifiably gone from the screen by then, not just told to leave.
  useEffect(() => {
    document.documentElement.classList.toggle("vb-scroll-locked", active);
    if (active) setCurtainActive(true);
    return () => document.documentElement.classList.remove("vb-scroll-locked");
  }, [active]);

  return (
    <AnimatePresence onExitComplete={() => setCurtainActive(false)}>
      {active && (
        <motion.div
          className={styles.curtain}
          initial={{ clipPath: "circle(0% at 50% 42%)" }}
          animate={{ clipPath: "circle(150% at 50% 42%)" }}
          exit={{ clipPath: "circle(0% at 50% 42%)" }}
          transition={{ duration: IRIS_DURATION, ease: EASE_OUT_EXPO }}
          aria-hidden="true"
        >
          <span className={styles.scanlines} />
          <p className={styles.wordmark}>
            <LetterReveal text="VIEWERBATTLE" reduced={reduced} stagger={0.03} delayChildren={0.15} letterDuration={0.4} />
          </p>
          <motion.span
            className={styles.sweepBar}
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 0.4, delay: IRIS_DURATION, ease: EASE_OUT_EXPO }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
