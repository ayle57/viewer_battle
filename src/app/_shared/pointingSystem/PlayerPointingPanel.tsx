"use client";

import type { PointingSystemState } from "@/domain/game/pointingSystem";
import { AnimatedScoreDisplay } from "@/app/_shared/boardQuestion/AnimatedScoreDisplay";
import styles from "./PlayerPointingPanel.module.css";

export interface PlayerPointingPanelProps {
  state: PointingSystemState;
}

const TEAM_LABEL: Record<"TEAM_A" | "TEAM_B", string> = { TEAM_A: "Team A", TEAM_B: "Team B" };

/**
 * Purely a spectator view — this engine's whole point is that the Host
 * is the sole judge of whatever's being played outside this app
 * (types.ts's top comment), so there's nothing for a Player to DO here
 * at all, unlike every other engine's own Player panel (no `sendAction`
 * prop, on purpose). Just the current name and the live scoreboard, so
 * a player glancing at their phone during Jackbox Party (or whatever)
 * sees the same score the Host/Display do.
 */
export function PlayerPointingPanel({ state }: PlayerPointingPanelProps) {
  const finished = state.status === "finished";
  const round = state.rounds[state.rounds.length - 1]!;

  return (
    <div className={styles.wrap}>
      <p className={styles.name} key={state.name}>
        {state.name}
      </p>
      {!finished && (
        <p className={styles.roundLabel} key={round.id}>
          {round.label}
        </p>
      )}

      <AnimatedScoreDisplay
        teamAName="Team A"
        teamAScore={state.scores.TEAM_A}
        teamBName="Team B"
        teamBScore={state.scores.TEAM_B}
        label={finished ? `Game over — ${state.winner === "TIE" ? "tie" : `${TEAM_LABEL[state.winner as "TEAM_A" | "TEAM_B"]} wins`}` : undefined}
      />

      {!finished && <p className={styles.statusLine}>The Host is keeping score — just watch along.</p>}
    </div>
  );
}
