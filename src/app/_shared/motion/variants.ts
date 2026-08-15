import type { Transition, Variants } from "motion/react";

/**
 * The app's one motion vocabulary — every choreographed sequence
 * (homepage intro, scroll storytelling, winner reveal, buzz impact)
 * builds from these instead of hand-rolling a new easing curve or
 * duration per screen. Nothing here is a source of truth for anything —
 * these are purely visual `Variants`, applied to `motion.*` elements
 * whose mount/unmount is still driven entirely by real props/state (a
 * derived `SessionPhase`, a real score, a real `buzzedTeam`). See
 * AGENTS.md "Session vs. Game phases".
 *
 * Every builder takes `reduced` (from `useReducedMotion()`, called once
 * per component) as its first argument — the reduced variant is never
 * "the same animation, faster," it's the actual end state with a short
 * cross-fade, per this app's `prefers-reduced-motion` contract.
 */

export const EASE_OUT_EXPO: Transition["ease"] = [0.16, 1, 0.3, 1];
// Softer than a UI micro-interaction spring on purpose — this app's
// entrances are meant to be watched, not just registered. Lower
// stiffness relative to damping means visibly more travel time before
// it settles, not just a snappier bounce.
export const EASE_SPRING_SNAPPY: Transition = { type: "spring", stiffness: 170, damping: 18, mass: 0.9 };
export const EASE_SPRING_SOFT: Transition = { type: "spring", stiffness: 110, damping: 16 };

/** A cinematic rise — the workhorse for headline/CTA/card entrances. */
export function fadeUp(reduced: boolean, opts?: { y?: number; duration?: number; delay?: number }): Variants {
  const y = reduced ? 4 : (opts?.y ?? 28);
  return {
    hidden: { opacity: 0, y },
    show: {
      opacity: 1,
      y: 0,
      transition: {
        duration: reduced ? 0.15 : (opts?.duration ?? 0.9),
        ease: EASE_OUT_EXPO,
        delay: reduced ? 0 : (opts?.delay ?? 0),
      },
    },
  };
}

/** A confident pop — for a moment that should feel like it "arrived," not just faded (a badge, a score, a winner line). */
export function popIn(reduced: boolean, opts?: { scale?: number; delay?: number }): Variants {
  const scale = reduced ? 0.98 : (opts?.scale ?? 0.7);
  return {
    hidden: { opacity: 0, scale },
    show: {
      opacity: 1,
      scale: 1,
      transition: reduced ? { duration: 0.15, delay: 0 } : { ...EASE_SPRING_SNAPPY, delay: opts?.delay ?? 0 },
    },
  };
}

/** Enters from a side — for two things meant to read as opposing (Team A / Team B). */
export function slideFrom(direction: "left" | "right", reduced: boolean, opts?: { distance?: number; delay?: number }): Variants {
  const distance = reduced ? 4 : (opts?.distance ?? 48);
  const x = direction === "left" ? -distance : distance;
  return {
    hidden: { opacity: 0, x },
    show: {
      opacity: 1,
      x: 0,
      transition: {
        duration: reduced ? 0.15 : 0.85,
        ease: EASE_OUT_EXPO,
        delay: reduced ? 0 : (opts?.delay ?? 0),
      },
    },
  };
}

/** A parent that hands its children a staggered start — reduced motion collapses the stagger to ~0 so everything still arrives together, fast. */
export function staggerContainer(reduced: boolean, opts?: { stagger?: number; delayChildren?: number }): Variants {
  return {
    hidden: {},
    show: {
      transition: reduced
        ? { staggerChildren: 0.02 }
        : { staggerChildren: opts?.stagger ?? 0.12, delayChildren: opts?.delayChildren ?? 0 },
    },
  };
}

/**
 * Scroll-triggered reveal defaults — one `viewport` config shared by
 * every entrance animation in the app, whether it's a ScrollStory
 * section, the homepage hero's own opening beats, or PageChangeCurtain's
 * wordmark: 30% of the element visible is the one threshold that decides
 * "this has arrived," everywhere. `once: true` so a returning visitor
 * scrolling back up never gets replayed at — that would read as broken,
 * not cinematic. Content that's already on screen at mount (like most of
 * the hero) still fires effectively immediately under this contract —
 * the observer's first check happens before first paint — so switching
 * something from a blind mount timer to this doesn't change its feel
 * when it's above the fold, it only fixes the case where it isn't.
 */
export const SCROLL_REVEAL_VIEWPORT = { once: true, amount: 0.3 } as const;

/**
 * Typography "arrival" — the stagger parent for `LetterReveal.tsx`
 * (src/app/_shared/motion/LetterReveal.tsx), which splits a short
 * wordmark into per-character `motion.span`s. Reduced motion collapses
 * the stagger to ~0 so the whole word still lands as one near-instant
 * cross-fade rather than a slow character crawl.
 */
export function letterContainer(reduced: boolean, opts?: { stagger?: number; delayChildren?: number }): Variants {
  return {
    hidden: {},
    show: {
      transition: reduced
        ? { staggerChildren: 0, delayChildren: 0 }
        : { staggerChildren: opts?.stagger ?? 0.035, delayChildren: opts?.delayChildren ?? 0 },
    },
  };
}

/** One character's own arrival — a soft blur-and-rise sharpening into place, `letterContainer`'s per-letter child variant. */
export function letterReveal(reduced: boolean, opts?: { duration?: number }): Variants {
  return {
    hidden: { opacity: 0, y: reduced ? 0 : 16, filter: reduced ? "blur(0px)" : "blur(9px)" },
    show: {
      opacity: 1,
      y: 0,
      filter: "blur(0px)",
      transition: reduced ? { duration: 0.15 } : { duration: opts?.duration ?? 0.4, ease: EASE_OUT_EXPO },
    },
  };
}
