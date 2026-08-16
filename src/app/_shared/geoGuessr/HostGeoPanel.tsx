"use client";

import { useState } from "react";
import type { GeoGuessrState } from "@/domain/game/geoGuessr";
import { AnimatedScoreDisplay } from "@/app/_shared/boardQuestion/AnimatedScoreDisplay"; // generic (ScoreDisplayProps-only) despite the folder name — see PlayerGeoPanel's identical reuse
import { Badge, Button, Card, CardBody, CardHeader, ClickableImageMap, ConfirmDialog, type MapMarker } from "@/ui";
import { readableGeoError } from "./gameErrorMessages";
import { formatDistance } from "./format";
import styles from "./HostGeoPanel.module.css";

export interface HostGeoPanelProps {
  state: GeoGuessrState;
  sendAction: (action: Record<string, unknown>) => Promise<{ ok: boolean; error?: { code: string; message: string } }>;
}

const TEAM_LABEL: Record<"TEAM_A" | "TEAM_B", string> = { TEAM_A: "Team A", TEAM_B: "Team B" };

/**
 * The host's régie — sees both teams' live guesses (the ONE role that
 * does, per view.ts's toPublicView) but the real target stays visually
 * hidden here too until the round is revealed, even though it's already
 * present in `state` (HOST always gets the full, unredacted engine
 * state — same posture as BoardQuestionEngine's answer key). That's a
 * deliberate UI choice, not a data one: showing it early would spoil the
 * host's own on-stream reaction for no gameplay reason, so this
 * component simply doesn't render a target marker before `phase ===
 * "revealed"`.
 */
export function HostGeoPanel({ state, sendAction }: HostGeoPanelProps) {
  const [pending, setPending] = useState<"NEXT_ROUND" | "END_GAME" | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [endGameOpen, setEndGameOpen] = useState(false);

  async function act(kind: "NEXT_ROUND" | "END_GAME", action: Record<string, unknown>) {
    setPending(kind);
    setError(null);
    const result = await sendAction(action);
    if (!result.ok && result.error) setError(result.error);
    setPending(null);
  }

  const round = state.rounds[state.currentRoundIndex];
  const revealed = state.phase === "revealed";

  const markers: MapMarker[] = [];
  if (revealed && state.roundResult) {
    markers.push({ id: "target", x: state.roundResult.targetX, y: state.roundResult.targetY, color: "target", label: "TARGET" });
    markers.push({ id: "TEAM_A", x: state.roundResult.guesses.TEAM_A.x, y: state.roundResult.guesses.TEAM_A.y, color: "teamA", label: "A" });
    markers.push({ id: "TEAM_B", x: state.roundResult.guesses.TEAM_B.x, y: state.roundResult.guesses.TEAM_B.y, color: "teamB", label: "B" });
  } else {
    if (state.guesses.TEAM_A) markers.push({ id: "TEAM_A", x: state.guesses.TEAM_A.x, y: state.guesses.TEAM_A.y, color: "teamA", label: "A" });
    if (state.guesses.TEAM_B) markers.push({ id: "TEAM_B", x: state.guesses.TEAM_B.x, y: state.guesses.TEAM_B.y, color: "teamB", label: "B" });
  }

  return (
    <div className={styles.wrap}>
      <Card variant="raised">
        <CardBody>
          <AnimatedScoreDisplay
            teamAName="Team A"
            teamAScore={state.scores.TEAM_A}
            teamBName="Team B"
            teamBScore={state.scores.TEAM_B}
            label={state.status === "finished" ? `Game over — ${state.winner === "TIE" ? "tie" : `${state.winner} wins`}` : undefined}
          />
        </CardBody>
      </Card>

      {state.status !== "finished" && (
        <div className={styles.endGameRow}>
          <Button variant="danger" size="sm" disabled={pending !== null} onClick={() => setEndGameOpen(true)}>
            End game
          </Button>
        </div>
      )}

      {error && <p className={styles.errorBanner}>{readableGeoError(error.code, error.message)}</p>}

      <div className={styles.teamStatusRow}>
        {(["TEAM_A", "TEAM_B"] as const).map((team) => {
          const locked = state.lockedTeams.includes(team);
          return (
            <div key={team} className={styles.teamStatus}>
              <Badge variant={team === "TEAM_A" ? "teamA" : "teamB"} dot>
                {TEAM_LABEL[team]}
              </Badge>
              <span className={locked ? styles.locked : styles.guessing}>{locked ? "✓ Locked" : "● Guessing"}</span>
            </div>
          );
        })}
      </div>

      {round && (
        <Card>
          <CardHeader
            title={round.question || `Round ${state.currentRoundIndex + 1}`}
            subtitle={revealed ? "Revealed — ready for the next round" : "Target hidden until both teams lock"}
          />
          <CardBody>
            <ClickableImageMap imageUrl={round.imageUrl} alt={round.title || `Round ${state.currentRoundIndex + 1} map`} markers={markers} empty={!round.imageUrl} />
          </CardBody>
        </Card>
      )}

      {revealed && state.roundResult && (
        <Card variant="raised">
          <CardBody>
            <div className={styles.resultBlock}>
              <p className={styles.resultHeadline}>
                {state.roundResult.roundWinner === "TIE" ? "ROUND TIED" : `${TEAM_LABEL[state.roundResult.roundWinner as "TEAM_A" | "TEAM_B"]} WINS THE ROUND`}
              </p>
              <div className={styles.distanceRow}>
                <span>Team A — {formatDistance(state.roundResult.distances.TEAM_A)}</span>
                <span>Team B — {formatDistance(state.roundResult.distances.TEAM_B)}</span>
              </div>
            </div>
            {state.status !== "finished" && (
              <div className={styles.nextRoundRow}>
                <Button size="lg" fullWidth loading={pending === "NEXT_ROUND"} disabled={pending !== null} onClick={() => void act("NEXT_ROUND", { type: "NEXT_ROUND" })}>
                  Next round →
                </Button>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      <ConfirmDialog
        open={endGameOpen}
        title="End this game now?"
        description="Whatever round is in progress is abandoned. The winner is whoever's ahead right now, or a tie if the scores are even."
        confirmLabel="End game"
        danger
        confirming={pending === "END_GAME"}
        onCancel={() => setEndGameOpen(false)}
        onConfirm={() => {
          setEndGameOpen(false);
          void act("END_GAME", { type: "END_GAME" });
        }}
      />
    </div>
  );
}
