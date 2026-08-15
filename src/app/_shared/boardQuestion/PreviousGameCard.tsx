"use client";

import type { BoardQuestionState } from "@/domain/game/boardQuestion";
import { Card, CardBody, CardHeader, ScoreDisplay } from "@/ui";
import styles from "./PreviousGameCard.module.css";

const TEAM_LABEL: Record<"TEAM_A" | "TEAM_B", string> = { TEAM_A: "Team A", TEAM_B: "Team B" };

export interface PreviousGameCardProps {
  /** The finished engine's label (e.g. "Mini Jeopardy" — GameEngine.label / registry.ts) — this card's own content (winner/scores) IS Jeopardy-specific (see below), the label is just what's shown to name it. */
  gameLabel: string;
  state: BoardQuestionState;
  size?: "md" | "lg";
}

/**
 * "Previous game" — what the Lobby shows once the most recent game has
 * finished (see AGENTS.md "Session vs. Game phases" / sessionPhase.ts's
 * GAME_FINISHED). Reads `state.winner`/`state.scores`, which are
 * BoardQuestionState fields, not part of the generic Game Kernel
 * contract — this card is Jeopardy-specific content, same as
 * HostBoardPanel/PlayerBoardPanel/DisplayBoardPanel already are; only the
 * PHASE this card appears in (sessionPhase.ts) is engine-agnostic.
 */
export function PreviousGameCard({ gameLabel, state, size = "md" }: PreviousGameCardProps) {
  const winnerClass = state.winner === "TEAM_A" ? styles.winnerA : state.winner === "TEAM_B" ? styles.winnerB : undefined;

  return (
    <Card variant="raised" className={styles.card}>
      <CardHeader title="Previous game" subtitle={gameLabel} />
      <CardBody>
        <ScoreDisplay
          teamAName="Team A"
          teamAScore={state.scores.TEAM_A}
          teamBName="Team B"
          teamBScore={state.scores.TEAM_B}
          size={size}
        />
        {state.winner && (
          <p className={[styles.winner, winnerClass].filter(Boolean).join(" ")}>
            {state.winner === "TIE" ? "It's a tie!" : (
              <>
                <span aria-hidden="true">🏆</span> {TEAM_LABEL[state.winner]} wins
              </>
            )}
          </p>
        )}
      </CardBody>
    </Card>
  );
}
