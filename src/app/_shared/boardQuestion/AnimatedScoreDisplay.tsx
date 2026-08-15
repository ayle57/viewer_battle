"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ScoreDisplay, type ScoreDisplayProps } from "@/ui";
import styles from "./AnimatedScoreDisplay.module.css";

/**
 * Wraps the real `ScoreDisplay` with "a point just landed" — a brief
 * impact on the number itself plus a flying `+N` next to whichever
 * team's score actually went up. Deliberately a separate component
 * rather than teaching `ScoreDisplay` itself about deltas: `ScoreDisplay`
 * is used everywhere a score is shown, including places where "this
 * just changed" is the wrong story to tell (the results splash showing
 * a final tally, `PreviousGameCard`, the homepage's illustrative demo) —
 * this wrapper is only for the three screens where scores genuinely
 * change live: HostBoardPanel, PlayerBoardPanel, DisplayBoardPanel.
 *
 * The delta is derived, not authoritative — `teamAScore`/`teamBScore`
 * (the real broadcast `game:state`) stay the only source of truth; this
 * component only remembers the PREVIOUS render's value (a plain `useRef`)
 * to compute what to show, never writes anything back and never gates
 * whether/how the real score renders.
 */
export function AnimatedScoreDisplay(props: ScoreDisplayProps) {
  const reduced = useReducedMotion() ?? false;
  const prevA = useRef(props.teamAScore);
  const prevB = useRef(props.teamBScore);
  const [deltaA, setDeltaA] = useState<{ amount: number; key: number } | null>(null);
  const [deltaB, setDeltaB] = useState<{ amount: number; key: number } | null>(null);

  useEffect(() => {
    const diff = props.teamAScore - prevA.current;
    prevA.current = props.teamAScore;
    if (diff <= 0) return;
    setDeltaA({ amount: diff, key: Date.now() });
    const timeout = setTimeout(() => setDeltaA(null), 1400);
    return () => clearTimeout(timeout);
  }, [props.teamAScore]);

  useEffect(() => {
    const diff = props.teamBScore - prevB.current;
    prevB.current = props.teamBScore;
    if (diff <= 0) return;
    setDeltaB({ amount: diff, key: Date.now() });
    const timeout = setTimeout(() => setDeltaB(null), 1400);
    return () => clearTimeout(timeout);
  }, [props.teamBScore]);

  return (
    <div className={styles.wrap}>
      <motion.div
        key={`${props.teamAScore}-${props.teamBScore}`}
        initial={reduced ? undefined : { scale: 1 }}
        animate={reduced ? undefined : { scale: [1, 1.14, 0.97, 1.02, 1] }}
        transition={{ duration: 0.55, ease: "easeOut", times: [0, 0.3, 0.55, 0.75, 1] }}
      >
        <ScoreDisplay {...props} />
      </motion.div>

      {/* The +N is meant to read as physically attached to the number it
          just came from — a fast spring with real overshoot, not an
          eased fade, so it feels shot upward rather than gently
          appearing. */}
      <AnimatePresence>
        {deltaA && (
          <motion.span
            key={deltaA.key}
            className={[styles.delta, styles.deltaA].join(" ")}
            initial={{ opacity: 0, y: 2, scale: 0.4 }}
            animate={{ opacity: 1, y: -16, scale: 1 }}
            exit={{ opacity: 0, y: -26, transition: { duration: 0.25 } }}
            transition={reduced ? { duration: 0.15 } : { type: "spring", stiffness: 480, damping: 15 }}
          >
            +{deltaA.amount}
          </motion.span>
        )}
        {deltaB && (
          <motion.span
            key={deltaB.key}
            className={[styles.delta, styles.deltaB].join(" ")}
            initial={{ opacity: 0, y: 2, scale: 0.4 }}
            animate={{ opacity: 1, y: -16, scale: 1 }}
            exit={{ opacity: 0, y: -26, transition: { duration: 0.25 } }}
            transition={reduced ? { duration: 0.15 } : { type: "spring", stiffness: 480, damping: 15 }}
          >
            +{deltaB.amount}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}
