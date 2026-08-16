"use client";

import type { TeamRole } from "@/domain/session";
import type { Scoreboard } from "@/domain/game";
import { Card, CardBody, CardHeader, ScoreDisplay } from "@/ui";
import styles from "./PreviousGameCard.module.css";

const TEAM_LABEL: Record<"TEAM_A" | "TEAM_B", string> = { TEAM_A: "Team A", TEAM_B: "Team B" };

export interface PreviousGameCardProps {
  /** The finished engine's label (e.g. "Mini Jeopardy", "GeoGuessr" — GameEngine.label / registry.ts) — this card's own content (winner/scores) is generic, the label is just what's shown to name it. */
  gameLabel: string;
  /**
   * Structural, not `BoardQuestionState` — `winner`/`scores` are the
   * ONLY fields this card ever reads, and every engine that uses
   * `scoring.ts`'s `Scoreboard` shape (BoardQuestionEngine, GeoGuessrEngine)
   * satisfies this without a cast. Narrowed from `BoardQuestionState` on
   * purpose so this card can be reused verbatim for a second engine —
   * still zero behavior change for Jeopardy, which already had exactly
   * this shape.
   */
  state: { winner: TeamRole | "TIE" | null; scores: Scoreboard };
  size?: "md" | "lg";
}

/**
 * "Previous game" — what the Lobby shows once the most recent game has
 * finished (see AGENTS.md "Session vs. Game phases" / sessionPhase.ts's
 * GAME_FINISHED). Reads `state.winner`/`state.scores` — generic Scoreboard
 * fields shared by every engine that uses scoring.ts's Scoreboard, not
 * BoardQuestionState-specific; only the PHASE this card appears in
 * (sessionPhase.ts) was ever meant to be engine-agnostic, and now the
 * card's own props are too.
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
