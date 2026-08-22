"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { useReducedMotionSafe } from "@/app/_shared/motion/useReducedMotionSafe";
import styles from "./GameStartingSequence.module.css";

const STAGES = ["READY", "3", "2", "1", "LIVE"] as const;
type Stage = (typeof STAGES)[number];
/** How long each stage holds before advancing to the next — a fixed, purely-visual timeline (see the file doc comment on why a timer here is fine). */
const STAGE_HOLD_MS: Record<Stage, number> = { READY: 260, "3": 340, "2": 340, "1": 340, LIVE: 500 };

export interface GameStartingSequenceProps {
  /** The one real fact this component ever reads: has `phase` (sessionPhase.ts) actually reached GAME_IN_PROGRESS yet — the broadcast `game:state` genuinely landed, not a guess. Only gates the HANDOFF (see below); never speeds up or skips the countdown itself. */
  live: boolean;
  /** Called once — when the local countdown has finished its own beat AND `live` is true. The caller (host/page.tsx) swaps back to its normal phase-driven rendering, which by then already shows the real board. */
  onDone: () => void;
}

/**
 * The "READY -> 3 -> 2 -> 1 -> LIVE" moment between clicking Start Game
 * and the board actually appearing — a fixed local animation timeline
 * (a fine use of `setTimeout`: it only decides which of five pieces of
 * TEXT is showing, the exact same class of cosmetic timer
 * SessionCodeBadge.tsx already uses for its "Copied!" reset, never a
 * stand-in for real game state). The countdown always plays its full
 * ~1.8s beat once started, whether the server responds instantly or
 * takes a moment — real broadcast countdowns don't get cut short just
 * because the segment was already cued up.
 *
 * The actual HANDOFF is where "the backend stays the source of truth"
 * is enforced: `onDone` only fires once the countdown reaches its LIVE
 * stage AND `live` (the real `phase === "GAME_IN_PROGRESS"`) is true. If
 * the server is slower than the countdown, LIVE holds with a small
 * "Connecting…" line instead of lying that the game has started — see
 * host/page.tsx's `sequenceActive` for what actually happens once this
 * calls back.
 */
export function GameStartingSequence({ live, onDone }: GameStartingSequenceProps) {
  const reduced = useReducedMotionSafe(); // hydration-safe — see that hook's own doc comment
  // Reduced motion skips straight to the terminal hold as the initial
  // state itself (no timed beats to play) rather than via an effect that
  // immediately calls setState on mount.
  const [index, setIndex] = useState(() => (reduced ? STAGES.length - 1 : 0));
  const stage = STAGES[index]!;
  const atFinalStage = index === STAGES.length - 1;

  useEffect(() => {
    if (reduced || atFinalStage) return;
    const timeout = setTimeout(() => setIndex((i) => i + 1), STAGE_HOLD_MS[STAGES[index]!]);
    return () => clearTimeout(timeout);
  }, [index, atFinalStage, reduced]);

  useEffect(() => {
    if (!atFinalStage || !live) return;
    const timeout = setTimeout(onDone, reduced ? 150 : 450);
    return () => clearTimeout(timeout);
  }, [atFinalStage, live, reduced, onDone]);

  return (
    <div className={styles.wrap} role="status" aria-live="polite">
      <motion.p
        key={stage}
        className={[styles.stage, stage === "LIVE" && styles.stageLive].filter(Boolean).join(" ")}
        initial={reduced ? undefined : { opacity: 0, scale: 0.55, y: 12 }}
        animate={reduced ? undefined : { opacity: 1, scale: 1, y: 0 }}
        transition={reduced ? { duration: 0.15 } : { type: "spring", stiffness: 380, damping: 18 }}
      >
        {stage}
      </motion.p>
      {atFinalStage && !live && <p className={styles.waitingHint}>Connecting…</p>}
    </div>
  );
}
