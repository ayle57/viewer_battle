"use client";

import { motion } from "motion/react";
import { useReducedMotionSafe } from "@/app/_shared/motion/useReducedMotionSafe";
import type { GeoGuessrState } from "@/domain/game/geoGuessr";
import { AnimatedScoreDisplay } from "@/app/_shared/boardQuestion/AnimatedScoreDisplay"; // generic (ScoreDisplayProps-only) despite the folder name — see PlayerGeoPanel's identical reuse
import { fadeUp, popIn } from "@/app/_shared/motion/variants";
import { Card, CardBody, ClickableImageMap, type MapLine, type MapMarker } from "@/ui";
import { formatDistance } from "./format";
import { CountdownBadge } from "@/app/_shared/CountdownBadge";
import { useRevealStage, REVEAL_STAGE_ORDER as STAGE_ORDER } from "./useRevealStage";
import { VictoryGlow } from "@/app/_shared/VictoryGlow";
import styles from "./DisplayGeoPanel.module.css";

export interface DisplayGeoPanelProps {
  state: GeoGuessrState;
}

const TEAM_LABEL: Record<"TEAM_A" | "TEAM_B", string> = { TEAM_A: "TEAM A", TEAM_B: "TEAM B" };

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
  const reduced = useReducedMotionSafe(); // hydration-safe — see that hook's own doc comment
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
    // A `null` guess (only reachable via a countdown forcing the round
    // closed with zero proposals queued — GeoRoundResult's own doc
    // comment) genuinely has nothing to draw — no marker, no line,
    // rather than a fabricated "at the target" spot.
    if (stageIndex >= STAGE_ORDER.indexOf("teamA") && result.guesses.TEAM_A) {
      markers.push({ id: "TEAM_A", x: result.guesses.TEAM_A.x, y: result.guesses.TEAM_A.y, color: "teamA", label: "TEAM A" });
      lines.push({ id: "line-a", from: result.guesses.TEAM_A, to: { x: result.targetX, y: result.targetY }, color: "teamA" });
    }
    if (stageIndex >= STAGE_ORDER.indexOf("teamB") && result.guesses.TEAM_B) {
      markers.push({ id: "TEAM_B", x: result.guesses.TEAM_B.x, y: result.guesses.TEAM_B.y, color: "teamB", label: "TEAM B" });
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

      {/* Read-only, OBS-scale — same as everywhere else on this panel, no `sendAction` anywhere near it (see CountdownBadge's own doc comment). Label matches HostGeoPanel's own "is this the last round" logic — see that component's own comment on why. */}
      <CountdownBadge
        deadlineMs={state.countdownDeadline}
        label={state.currentRoundIndex >= state.rounds.length - 1 ? "Game ends in" : "Round ends in"}
        className={styles.countdownBadge}
      />

      {/* `key={currentRoundIndex}` — a genuine "ROUND 04" arrival plays
          this entrance exactly once per real round change (item 10/17),
          never a loop, never anything deciding WHEN the round actually
          advances (that's still purely `state.currentRoundIndex`, only
          ever moved by the server's own NEXT_ROUND broadcast). */}
      <motion.div key={state.currentRoundIndex} initial="hidden" animate="show" variants={fadeUp(reduced, { y: 14, duration: 0.4 })}>
        <p className={styles.roundLabel}>
          ROUND {state.currentRoundIndex + 1} / {state.rounds.length}
        </p>
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
      </motion.div>

      {/* Hidden once the winner banner takes over (below) — two "this is
          the moment" captions on screen at once undercuts the one that
          actually matters. */}
      {revealed && stage !== "winner" && (
        <motion.p key={`caption-${stage}`} className={styles.revealCaption} initial="hidden" animate="show" variants={popIn(reduced)}>
          {stage === "locked" ? "LOCKED" : "REVEAL"}
        </motion.p>
      )}

      {round && (
        <Card className={styles.mapCard}>
          <CardBody>
            <ClickableImageMap
              imageUrl={round.imageUrl}
              alt={round.title || `Round ${state.currentRoundIndex + 1} map`}
              markers={markers}
              lines={lines}
              empty={!round.imageUrl}
              emptyLabel="Map unavailable"
            />
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
        <div className={styles.winnerStage}>
          {/* Full-viewport wash — src/app/_shared/VictoryGlow.tsx, the
              same one WinnerReveal.tsx uses for the game-level winner —
              skipped entirely on a TIE (no team to spotlight). */}
          {state.roundResult.roundWinner !== "TIE" && <VictoryGlow team={state.roundResult.roundWinner} />}
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
        </div>
      )}
    </div>
  );
}
