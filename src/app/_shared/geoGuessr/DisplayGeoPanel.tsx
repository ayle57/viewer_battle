"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { GeoGuessrState } from "@/domain/game/geoGuessr";
import { AnimatedScoreDisplay } from "@/app/_shared/boardQuestion/AnimatedScoreDisplay"; // generic (ScoreDisplayProps-only) despite the folder name — see PlayerGeoPanel's identical reuse
import { fadeUp, popIn } from "@/app/_shared/motion/variants";
import { Card, CardBody, ClickableImageMap, type MapLine, type MapMarker } from "@/ui";
import { formatDistance } from "./format";
import styles from "./DisplayGeoPanel.module.css";

export interface DisplayGeoPanelProps {
  state: GeoGuessrState;
}

const TEAM_LABEL: Record<"TEAM_A" | "TEAM_B", string> = { TEAM_A: "TEAM A", TEAM_B: "TEAM B" };

/**
 * The reveal STAGE — purely cosmetic sequencing of what's already fully
 * known the instant `state.phase` becomes "revealed" (target + both
 * guesses + distances + winner all arrive together in ONE `roundResult`,
 * per src/domain/game/geoGuessr/engine.ts's doc comment). This local
 * timer only decides which of five VISUAL beats is showing — never a
 * `sendAction` call, never anything that could change gameplay (Display
 * has no `sendAction` at all, same as DisplayBoardPanel) — exactly the
 * same class of purely-cosmetic timer GameStartingSequence.tsx already
 * uses for its READY->3->2->1->LIVE beats, which AGENTS.md's "no
 * setTimeout deciding gameplay" rule was never about.
 */
type RevealStage = "locked" | "reveal" | "guesses" | "distances" | "winner";
const STAGE_ORDER: RevealStage[] = ["locked", "reveal", "guesses", "distances", "winner"];
const STAGE_HOLD_MS: Record<RevealStage, number> = { locked: 450, reveal: 550, guesses: 650, distances: 700, winner: 0 };

function useRevealStage(active: boolean, resetKey: string, reduced: boolean): RevealStage {
  const [index, setIndex] = useState(0);
  // Render-phase reset on a genuine new round/reveal — React's own
  // blessed "adjusting state when a prop changes" pattern (two setState
  // calls in the same render branch, comparing against a STATE-tracked
  // previous value, never a ref — refs can't be read/written during
  // render). `effectiveIndex` is what THIS render actually uses, so a
  // fresh round starts its sequence from stage 0 in the same render that
  // noticed the change, rather than one render late.
  const [prevResetKey, setPrevResetKey] = useState(resetKey);
  let effectiveIndex = index;
  if (prevResetKey !== resetKey) {
    setPrevResetKey(resetKey);
    effectiveIndex = 0;
    setIndex(0);
  }

  useEffect(() => {
    if (!active || reduced) return;
    if (effectiveIndex >= STAGE_ORDER.length - 1) return;
    const timeout = setTimeout(() => setIndex((i) => i + 1), STAGE_HOLD_MS[STAGE_ORDER[effectiveIndex]!]);
    return () => clearTimeout(timeout);
  }, [active, reduced, effectiveIndex]);

  if (!active) return "locked";
  return reduced ? "winner" : STAGE_ORDER[effectiveIndex]!;
}

/**
 * Read-only, OBS-scale — no `sendAction` anywhere in this component, same
 * "no path to game:action" guarantee DisplayBoardPanel has. Pre-reveal:
 * big map, round number, "TEAM A/B — LOCKED" status, no guesses shown
 * (the private-ping guarantee — this client's own `game:state` never
 * even CONTAINS a live guess pre-reveal, see view.ts's toPublicView, so
 * there's nothing here that could leak one even by accident). Post-
 * reveal: the staged premium reveal above.
 */
export function DisplayGeoPanel({ state }: DisplayGeoPanelProps) {
  const reduced = useReducedMotion() ?? false;
  const round = state.rounds[state.currentRoundIndex];
  const revealed = state.phase === "revealed" && Boolean(state.roundResult);
  const resetKey = `${state.currentRoundIndex}-${revealed}`;
  const stage = useRevealStage(revealed, resetKey, reduced);
  const stageIndex = STAGE_ORDER.indexOf(stage);

  const markers: MapMarker[] = [];
  const lines: MapLine[] = [];
  if (revealed && state.roundResult) {
    const result = state.roundResult;
    if (stageIndex >= STAGE_ORDER.indexOf("reveal")) {
      markers.push({ id: "target", x: result.targetX, y: result.targetY, color: "target", label: "TARGET" });
    }
    if (stageIndex >= STAGE_ORDER.indexOf("guesses")) {
      markers.push({ id: "TEAM_A", x: result.guesses.TEAM_A.x, y: result.guesses.TEAM_A.y, color: "teamA", label: "TEAM A" });
      markers.push({ id: "TEAM_B", x: result.guesses.TEAM_B.x, y: result.guesses.TEAM_B.y, color: "teamB", label: "TEAM B" });
      lines.push({ id: "line-a", from: result.guesses.TEAM_A, to: { x: result.targetX, y: result.targetY }, color: "teamA" });
      lines.push({ id: "line-b", from: result.guesses.TEAM_B, to: { x: result.targetX, y: result.targetY }, color: "teamB" });
    }
  }

  return (
    <div className={styles.wrap}>
      <Card variant="raised" className={styles.scoreCard}>
        <CardBody>
          <AnimatedScoreDisplay teamAName="Team A" teamAScore={state.scores.TEAM_A} teamBName="Team B" teamBScore={state.scores.TEAM_B} size="lg" />
        </CardBody>
      </Card>

      <p className={styles.roundLabel}>ROUND {state.currentRoundIndex + 1}</p>
      {!revealed && round?.question && <p className={styles.question}>{round.question}</p>}

      {!revealed && (
        <div className={styles.lockStatusRow}>
          {(["TEAM_A", "TEAM_B"] as const).map((team) => (
            <span key={team} className={[styles.lockChip, state.lockedTeams.includes(team) ? styles.lockChipLocked : undefined].filter(Boolean).join(" ")}>
              {TEAM_LABEL[team]} — {state.lockedTeams.includes(team) ? "LOCKED" : "GUESSING"}
            </span>
          ))}
        </div>
      )}

      {revealed && (
        <motion.p key={`caption-${stage}`} className={styles.revealCaption} initial="hidden" animate="show" variants={popIn(reduced)}>
          {stage === "locked" ? "LOCKED" : "REVEAL"}
        </motion.p>
      )}

      {round && (
        <Card className={styles.mapCard}>
          <CardBody>
            <ClickableImageMap imageUrl={round.imageUrl} alt={round.title || `Round ${state.currentRoundIndex + 1} map`} markers={markers} lines={lines} empty={!round.imageUrl} />
          </CardBody>
        </Card>
      )}

      {revealed && state.roundResult && stageIndex >= STAGE_ORDER.indexOf("distances") && (
        <motion.div className={styles.distanceRow} initial="hidden" animate="show" variants={fadeUp(reduced)}>
          <span className={styles.distanceTeamA}>Team A — {formatDistance(state.roundResult.distances.TEAM_A)}</span>
          <span className={styles.distanceTeamB}>Team B — {formatDistance(state.roundResult.distances.TEAM_B)}</span>
        </motion.div>
      )}

      {revealed && state.roundResult && stage === "winner" && (
        <motion.p
          className={[styles.winnerBanner, state.roundResult.roundWinner === "TEAM_A" && styles.winnerA, state.roundResult.roundWinner === "TEAM_B" && styles.winnerB]
            .filter(Boolean)
            .join(" ")}
          initial="hidden"
          animate="show"
          variants={popIn(reduced, { scale: 0.85 })}
        >
          {state.roundResult.roundWinner === "TIE" ? "ROUND TIED" : (
            <>
              <span aria-hidden="true">🏆</span> {TEAM_LABEL[state.roundResult.roundWinner as "TEAM_A" | "TEAM_B"]} WINS THE ROUND
            </>
          )}
        </motion.p>
      )}
    </div>
  );
}
