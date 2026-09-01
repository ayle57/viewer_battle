"use client";

import { motion } from "motion/react";
import { useReducedMotionSafe } from "@/app/_shared/motion/useReducedMotionSafe";
import { ScoreDisplay } from "@/ui";
import { fadeUp, EASE_OUT_EXPO, EASE_SPRING_SNAPPY } from "@/app/_shared/motion/variants";
import { LetterReveal } from "@/app/_shared/motion/LetterReveal";
import { VictoryGlow } from "@/app/_shared/VictoryGlow";
import styles from "./WinnerReveal.module.css";

/**
 * A handful of tiny dots radiating from the trophy — the "extrêmement
 * subtile" celebration the brief explicitly invited if it stays premium,
 * not literal confetti (no physics, no fall, no color chaos): eight fixed
 * trajectories, one team-tinted color, ~0.6s, gone. Precomputed rather
 * than randomized so the reveal is identical every time, not jittery.
 */
const BURST_PARTICLES = [
  { angle: -80, distance: 46 },
  { angle: -45, distance: 56 },
  { angle: -10, distance: 50 },
  { angle: 30, distance: 44 },
  { angle: 65, distance: 52 },
  { angle: -130, distance: 42 },
  { angle: 145, distance: 46 },
  { angle: 180, distance: 40 },
].map(({ angle, distance }) => {
  const rad = (angle * Math.PI) / 180;
  return { x: Math.cos(rad) * distance, y: Math.sin(rad) * distance };
});

export interface WinnerRevealProps {
  winner: "TEAM_A" | "TEAM_B" | "TIE";
  teamAScore: number;
  teamBScore: number;
  /** "md" fits Host's card; "lg" is the Display's OBS-scale treatment — this IS the moment a streamer is most likely to have on screen when their audience is watching, so it gets real weight there. */
  size?: "md" | "lg";
  /** Defaults to "Game Over" (unchanged for both existing callers — Host's results splash, Display's finished state). The Show layer reuses this exact same choreography for its OWN final result (`winner`/scores already generic — see this component's own doc comment) with `eyebrow="Show Over"`, rather than a second, duplicated reveal component. */
  eyebrow?: string;
  /**
   * ONLY the Player passes this (their own `role`) — Host and Display
   * have no personal stake in the result, so they keep the third-person
   * "TEAM A WINS" grammar unchanged. A real, audited inconsistency this
   * closes: PlayerGeoPanel's own round result already used a personal
   * "YOU WON"/"YOU LOST" grammar (with a deliberate, documented reason —
   * see that component's own `RoundResultSummary` doc comment: a loss
   * stays calm/muted, never celebrating the OPPONENT's color on the
   * losing viewer's own screen), while this component — the one a
   * Mini Jeopardy player actually sees at GAME OVER — still announced
   * "TEAM A WINS" in third person, never actually telling THIS viewer
   * whether they themselves won. Same grammar, same "muted on a loss"
   * principle, now shared instead of forked.
   */
  viewerTeam?: "TEAM_A" | "TEAM_B";
}

/**
 * The one winner-reveal choreography, shared by Host's results splash
 * and Display's finished state instead of two versions drifting apart —
 * `GAME OVER` -> the final score settles in -> a spotlight irises open
 * behind the trophy -> the trophy drops in with a spring bounce and its
 * burst -> the winning team's name builds itself letter by letter (the
 * same `LetterReveal` primitive the homepage/loader use, so this reads
 * as the same show rather than a one-off effect) -> a beat later, the
 * `+1` this win just added to the session's match score (see
 * `MatchScore.tsx` / `getWinner` in AGENTS.md) lands, connecting THIS
 * win back to the running tally instead of leaving it feeling like a
 * dead end. Every stage is timed relative to mount (this component
 * mounts exactly when `state.status === "finished"` — a real fact from
 * the broadcast `game:state`, never a local guess — and unmounts on the
 * phase change back out of GAME_FINISHED, so a second game finishing
 * later gets a genuinely fresh mount and replays in full), so the whole
 * sequence is a one-shot consequence of real state, not a loop
 * pretending to be gameplay.
 *
 * The background wash behind the reveal is `VictoryGlow` (src/app/
 * _shared/) — a full-viewport, portaled spotlight, not a div scoped to
 * this component's own small box (see that component's own doc comment
 * for the real "coupée pas correctement" complaint this used to have).
 */
export function WinnerReveal({ winner, teamAScore, teamBScore, size = "md", eyebrow = "Game Over", viewerTeam }: WinnerRevealProps) {
  const reduced = useReducedMotionSafe(); // hydration-safe — see that hook's own doc comment
  // `undefined` = not personalized (Host/Display, unchanged) or a tie
  // (no "you" framing applies to a tie either way); `true`/`false` = this
  // viewer's own team won/lost.
  const iWon = viewerTeam && winner !== "TIE" ? viewerTeam === winner : undefined;
  // The trophy, its burst, and VictoryGlow are a CELEBRATION, reserved
  // for an actual win — suppressed (not recolored) on a personalized
  // loss, same "fort mais pas kitsch" reasoning PlayerGeoPanel's own
  // RoundResultSummary already documents: showing the opponent's own
  // victory trophy on the losing viewer's screen reads as congratulating
  // them, not informing this viewer of the result.
  const celebrate = winner !== "TIE" && iWon !== false;
  const winnerClass = celebrate ? (winner === "TEAM_A" ? styles.winnerA : styles.winnerB) : undefined;
  const winnerText = winner === "TIE" ? "IT'S A TIE" : iWon === undefined ? (winner === "TEAM_A" ? "TEAM A WINS" : "TEAM B WINS") : iWon ? "YOU WON" : "YOU LOST";

  return (
    // `role="status"`/`aria-live="polite"` — a real, audited gap: the
    // single biggest moment in the whole app (shared by Host's results
    // splash, Display's finished state, AND the Show's own final result)
    // was announced to nobody using a screen reader. `LetterReveal`
    // below already carries its own `aria-label` with the real winner
    // text (its per-letter spans are `aria-hidden`) — this just makes
    // this whole region a live one, so mounting it (the moment
    // `state.status === "finished"` really happens) actually gets
    // announced.
    <div className={[styles.wrap, size === "lg" && styles.wrapLg].filter(Boolean).join(" ")} role="status" aria-live="polite">
      {celebrate && <VictoryGlow team={winner as "TEAM_A" | "TEAM_B"} />}

      <motion.p className={styles.eyebrow} initial="hidden" animate="show" variants={fadeUp(reduced)}>
        {eyebrow}
      </motion.p>

      <motion.div className={styles.scoreLayer} initial="hidden" animate="show" variants={fadeUp(reduced, { delay: 0.15 })}>
        <ScoreDisplay teamAName="Team A" teamAScore={teamAScore} teamBName="Team B" teamBScore={teamBScore} size={size} />
      </motion.div>

      <div className={styles.winnerRow}>
        {celebrate && (
          <span className={styles.trophyWrap}>
            <motion.span
              className={styles.trophy}
              aria-hidden="true"
              initial={reduced ? undefined : { scale: 0, rotate: -25, opacity: 0 }}
              animate={reduced ? undefined : { scale: 1, rotate: 0, opacity: 1 }}
              transition={reduced ? { duration: 0.15 } : { ...EASE_SPRING_SNAPPY, delay: 0.65 }}
            >
              🏆
            </motion.span>
            {!reduced &&
              BURST_PARTICLES.map((p, i) => (
                <motion.span
                  key={i}
                  className={[styles.burstDot, winnerClass].filter(Boolean).join(" ")}
                  aria-hidden="true"
                  initial={{ opacity: 0.9, x: 0, y: 0, scale: 1 }}
                  animate={{ opacity: 0, x: p.x, y: p.y, scale: 0.4 }}
                  transition={{ delay: 0.85, duration: 0.6, ease: EASE_OUT_EXPO }}
                />
              ))}
          </span>
        )}

        <p className={[styles.winnerText, winnerClass].filter(Boolean).join(" ")}>
          <LetterReveal text={winnerText} reduced={reduced} stagger={0.035} delayChildren={winner === "TIE" ? 0.6 : 0.95} />
        </p>
      </div>

      {winner !== "TIE" && (
        <motion.p
          className={[styles.matchPoint, winnerClass].filter(Boolean).join(" ")}
          initial={{ opacity: 0, y: 6, scale: 0.85 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={reduced ? { duration: 0.15 } : { ...EASE_SPRING_SNAPPY, delay: 1.4 }}
        >
          +1 match point
        </motion.p>
      )}
    </div>
  );
}
