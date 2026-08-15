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
 * Always fires on plain `animate` (unconditional on mount) — there used
 * to be a `whileInView` option for scroll-triggered use, dropped after a
 * real-browser check found Framer Motion's `whileInView` never actually
 * applies its hidden state in this app's setup at all (see
 * useScrollReveal.ts's doc comment for the full story); every current
 * caller is either always-in-view at mount (the hero, the curtain) or
 * itself gated by `useScrollReveal` one level up (WinnerReveal, driven
 * by real game state, not scroll position).
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
}: {
  text: string;
  reduced: boolean;
  stagger?: number;
  delayChildren?: number;
  letterDuration?: number;
  className?: string;
  letterClassName?: string;
}) {
  return (
    <motion.span
      className={className}
      initial="hidden"
      animate="show"
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
