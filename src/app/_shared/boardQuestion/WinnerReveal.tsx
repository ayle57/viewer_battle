"use client";

import { motion, useReducedMotion } from "motion/react";
import { ScoreDisplay } from "@/ui";
import { fadeUp, EASE_OUT_EXPO, EASE_SPRING_SNAPPY } from "@/app/_shared/motion/variants";
import { LetterReveal } from "@/app/_shared/motion/LetterReveal";
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
 * The spotlight is a `clip-path: circle()` iris (PageChangeCurtain's own
 * technique), not a blurred div — the previous version blurred a circle
 * against `overflow: hidden`, which hard-clips a soft blur into a
 * visible rectangular seam right where it should fade out; clip-path
 * has no such edge to clip.
 */
export function WinnerReveal({ winner, teamAScore, teamBScore, size = "md" }: WinnerRevealProps) {
  const reduced = useReducedMotion() ?? false;
  const glowClass = winner === "TEAM_A" ? styles.glowA : winner === "TEAM_B" ? styles.glowB : undefined;
  const winnerClass = winner === "TEAM_A" ? styles.winnerA : winner === "TEAM_B" ? styles.winnerB : undefined;
  const winnerText = winner === "TIE" ? "IT'S A TIE" : winner === "TEAM_A" ? "TEAM A WINS" : "TEAM B WINS";

  return (
    <div className={[styles.wrap, size === "lg" && styles.wrapLg].filter(Boolean).join(" ")}>
      {glowClass && (
        <motion.div
          className={[styles.glow, glowClass].join(" ")}
          aria-hidden="true"
          initial={{ clipPath: "circle(0% at 50% 55%)" }}
          animate={{ clipPath: "circle(75% at 50% 55%)" }}
          transition={reduced ? { duration: 0.15 } : { delay: 0.5, duration: 0.7, ease: EASE_OUT_EXPO }}
        />
      )}

      <motion.p className={styles.eyebrow} initial="hidden" animate="show" variants={fadeUp(reduced)}>
        Game Over
      </motion.p>

      <motion.div className={styles.scoreLayer} initial="hidden" animate="show" variants={fadeUp(reduced, { delay: 0.15 })}>
        <ScoreDisplay teamAName="Team A" teamAScore={teamAScore} teamBName="Team B" teamBScore={teamBScore} size={size} />
      </motion.div>

      <div className={styles.winnerRow}>
        {winner !== "TIE" && (
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
