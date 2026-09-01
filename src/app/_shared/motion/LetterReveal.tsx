"use client";

import { useMemo } from "react";
import { AnimatePresence, motion } from "motion/react";
import { letterContainer, letterReveal } from "@/app/_shared/motion/variants";

/**
 * Splits `text` into per-character `motion.span`s that blur-and-rise into
 * place on a stagger — the one "typography arrival" primitive, shared by
 * PageChangeCurtain's brand flash, CinematicHero's hero wordmark, and
 * WinnerReveal's team-name reveal, so all three read as the same
 * directed motion vocabulary (see variants.ts) instead of hand-rolled
 * effects. Owns only the character choreography, never document
 * semantics — wrap it in whatever heading/paragraph tag the call site
 * needs; it renders as an inline `motion.span`. `aria-label={text}` on
 * the wrapper plus `aria-hidden` on every letter means a screen reader
 * announces the whole word once, never a letter-by-letter spell-out.
 *
 * Fires on plain `animate`, defaulting to unconditional (`"show"` on
 * mount) — there used to be a `whileInView` option for scroll-triggered
 * use, dropped after a real-browser check found Framer Motion's
 * `whileInView` never actually applies its hidden state in this app's
 * setup at all (see useScrollReveal.ts's doc comment for the full
 * story). Callers that DO need scroll-triggered timing (CinematicHero's
 * hero wordmark) drive `animate` themselves off their own
 * `useScrollReveal` — same "the caller owns the IntersectionObserver,
 * this component only owns the character choreography" split
 * `useScrollReveal` itself uses for `motion`'s `animate` prop. Every
 * other caller (PageChangeCurtain's own wordmark, WinnerReveal's team
 * name) leaves it at the default: always-in-view at mount, or itself
 * gated by a real mount/unmount off actual game state, not scroll
 * position — genuinely unconditional either way.
 *
 * `reduced` is the caller's own `useReducedMotion()` read (this
 * component doesn't call the hook itself, so one read stays the single
 * source of truth per screen, same convention as every `variants.ts`
 * builder) — with it true, the word still appears, just as a single
 * near-instant cross-fade with no stagger, no blur, no travel.
 *
 * Wrapped in its own local `<AnimatePresence>` (no `initial={false}`) —
 * a REAL, REPRODUCED bug this closes, confirmed live with instrumented
 * DOM observation, not a guess: WinnerReveal's own team-name reveal
 * never actually showed its blur-and-rise on `/player`
 * ("l'effet de blur est cassé... écrans de player"), even though the
 * exact same primitive correctly blurred-in for PageChangeCurtain's
 * wordmark. Root cause: every route's whole tree is wrapped in
 * `PageTransition.tsx`'s own `<AnimatePresence initial={false}>` (see
 * layout.tsx) — deliberately so a fresh page load never plays that
 * curtain's OWN slide-in. But that `initial={false}` cascades down
 * through ALL nested `motion` components mounting later in the SAME
 * pathname's lifetime, not just PageTransition's own direct child —
 * `/player` never changes pathname while a game plays, so WinnerReveal,
 * mounting minutes later when the game ends, was still being treated as
 * part of that same suppressed "initial" batch: every letter rendered
 * straight in its resting `show` state, blur skipped entirely.
 * PageChangeCurtain sits OUTSIDE PageTransition (a layout.tsx sibling,
 * not inside `{children}`), so it never inherited the suppression — the
 * one structural difference that made it "work" while WinnerReveal
 * didn't. A local `<AnimatePresence>` here re-establishes a fresh
 * presence context for just this subtree, overriding the ambient
 * `initial={false}` without touching PageTransition's own behavior
 * (still exactly zero page-slide on first load) or any other consumer.
 *
 * `letterContainer(...)`/`letterReveal(...)` are ALSO memoized
 * (`useMemo` below) rather than called inline in the JSX — a real,
 * independently-found second issue: `/player` polls `session.getState`
 * every 2s (player/page.tsx) alongside the real-time socket state, and a
 * refetch landing mid-animation re-renders `WinnerReveal` with
 * value-identical props; a fresh (non-memoized) `Variants` object on
 * that re-render gives Framer Motion a reason to reconcile the
 * in-flight staggered children rather than leave them alone. Harmless
 * either way, but worth keeping regardless of the fix above.
 */
export function LetterReveal({
  text,
  reduced,
  stagger,
  delayChildren,
  letterDuration,
  className,
  letterClassName,
  animate = "show",
}: {
  text: string;
  reduced: boolean;
  stagger?: number;
  delayChildren?: number;
  letterDuration?: number;
  className?: string;
  letterClassName?: string;
  /** Drive this from the caller's own `useScrollReveal` for scroll-triggered use; defaults to unconditional (fires on mount). */
  animate?: "show" | "hidden";
}) {
  // Memoized on the scalar inputs, not called inline — see this file's
  // own doc comment for the real bug a fresh object here caused.
  const containerVariants = useMemo(() => letterContainer(reduced, { stagger, delayChildren }), [reduced, stagger, delayChildren]);
  const letterVariants = useMemo(() => letterReveal(reduced, { duration: letterDuration }), [reduced, letterDuration]);

  return (
    <AnimatePresence>
      <motion.span
        className={className}
        initial="hidden"
        animate={animate}
        variants={containerVariants}
        style={{ display: "inline-block", whiteSpace: "pre" }}
        aria-label={text}
      >
        {text.split("").map((char, i) => (
          <motion.span
            key={`${char}-${i}`}
            className={letterClassName}
            variants={letterVariants}
            style={{ display: "inline-block" }}
            aria-hidden="true"
          >
            {char}
          </motion.span>
        ))}
      </motion.span>
    </AnimatePresence>
  );
}
