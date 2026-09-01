"use client";

import type { PointingSystemState } from "@/domain/game/pointingSystem";
import { Card, CardBody } from "@/ui";
import { AnimatedScoreDisplay } from "@/app/_shared/boardQuestion/AnimatedScoreDisplay";
import styles from "./DisplayPointingPanel.module.css";

export interface DisplayPointingPanelProps {
  state: PointingSystemState;
}

const TEAM_LABEL: Record<"TEAM_A" | "TEAM_B", string> = { TEAM_A: "TEAM A", TEAM_B: "TEAM B" };

/**
 * Read-only, built for OBS capture — same posture as every other engine's
 * own Display panel: no `sendAction` prop, nothing here decides anything.
 * The screen is the current name (whatever the Host is actually playing
 * right now — "Jackbox Party" and friends, types.ts's own doc comment),
 * which round of it ("Fibbage", "Round 2"), and a big scoreboard —
 * `AnimatedScoreDisplay` already gives the "+N just landed" flourish
 * other engines get, no extra work needed here to make a point change
 * feel alive on stream. `key={state.name}`/`key={round.id}` remount
 * `.name`/`.roundLabel` on a real rename or a genuine NEXT_ROUND (not on
 * every score tick, which touches neither) — a plain CSS entrance is
 * enough of a "this just changed" cue without a separate events.ts
 * module this engine has no other reason to need.
 */
export function DisplayPointingPanel({ state }: DisplayPointingPanelProps) {
  const finishedClass = state.winner === "TEAM_A" ? styles.finishedA : state.winner === "TEAM_B" ? styles.finishedB : undefined;
  const round = state.rounds[state.rounds.length - 1]!;

  return (
    <div className={styles.wrap}>
      <p className={styles.name} key={state.name}>
        {state.name}
      </p>
      {state.status !== "finished" && (
        <p className={styles.roundLabel} key={round.id}>
          {round.label}
        </p>
      )}

      <Card variant="raised" className={styles.scoreCard}>
        <CardBody>
          <AnimatedScoreDisplay teamAName="Team A" teamAScore={state.scores.TEAM_A} teamBName="Team B" teamBScore={state.scores.TEAM_B} size="lg" />
        </CardBody>
      </Card>

      {state.status === "finished" && (
        <p className={[styles.finishedBanner, finishedClass].filter(Boolean).join(" ")}>
          {state.winner === "TIE" ? (
            "IT'S A TIE"
          ) : (
            <>
              <span aria-hidden="true">🏆</span> {TEAM_LABEL[state.winner as "TEAM_A" | "TEAM_B"]} WINS
            </>
          )}
        </p>
      )}
    </div>
  );
}
