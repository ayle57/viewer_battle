"use client";

import { motion } from "motion/react";
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
  return (
    <motion.span
      className={className}
      initial="hidden"
      animate={animate}
      variants={letterContainer(reduced, { stagger, delayChildren })}
      style={{ display: "inline-block", whiteSpace: "pre" }}
      aria-label={text}
    >
      {text.split("").map((char, i) => (
        <motion.span
          key={`${char}-${i}`}
          className={letterClassName}
          variants={letterReveal(reduced, { duration: letterDuration })}
          style={{ display: "inline-block" }}
          aria-hidden="true"
        >
          {char}
        </motion.span>
      ))}
    </motion.span>
  );
}
