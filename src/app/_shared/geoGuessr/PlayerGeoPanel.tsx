"use client";

import { useState } from "react";
import type { GeoGuessrState } from "@/domain/game/geoGuessr";
import { AnimatedScoreDisplay } from "@/app/_shared/boardQuestion/AnimatedScoreDisplay";
import { Badge, Button, Card, CardBody, ClickableImageMap, type MapMarker } from "@/ui";
import { readableGeoError } from "./gameErrorMessages";
import { formatDistance } from "./format";
import styles from "./PlayerGeoPanel.module.css";

export interface PlayerGeoPanelProps {
  state: GeoGuessrState;
  role: "TEAM_A" | "TEAM_B";
  sendAction: (action: Record<string, unknown>) => Promise<{ ok: boolean; error?: { code: string; message: string } }>;
}

const TEAM_LABEL: Record<"TEAM_A" | "TEAM_B", string> = { TEAM_A: "TEAM A", TEAM_B: "TEAM B" };
const MARKER_COLOR: Record<"TEAM_A" | "TEAM_B", "teamA" | "teamB"> = { TEAM_A: "teamA", TEAM_B: "teamB" };

/**
 * The player's guess UI — "PLACE YOUR GUESS" -> tap the map -> "LOCK
 * GUESS" -> "GUESS LOCKED", exactly the product brief's flow. Every
 * guess/lock is a real `game:action`; this component never decides
 * anything about whether a guess is allowed, it only reflects
 * `state.guesses[role]`/`state.lockedTeams` — both already scoped to
 * exactly what this role is allowed to see (view.ts's toPublicView: the
 * OTHER team's live guess is never even sent to this client before
 * reveal, so there's nothing here that could leak it even by accident).
 */
export function PlayerGeoPanel({ state, role, sendAction }: PlayerGeoPanelProps) {
  const [placing, setPlacing] = useState(false);
  const [locking, setLocking] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);

  const otherTeam = role === "TEAM_A" ? "TEAM_B" : "TEAM_A";
  const round = state.rounds[state.currentRoundIndex];
  const myGuess = state.guesses[role];
  const myLocked = state.lockedTeams.includes(role);
  const otherLocked = state.lockedTeams.includes(otherTeam);
  const revealed = state.phase === "revealed";

  async function placeGuess(x: number, y: number) {
    setPlacing(true);
    setError(null);
    const result = await sendAction({ type: "SET_GUESS", x, y });
    if (!result.ok && result.error) setError(result.error);
    setPlacing(false);
  }

  async function lockGuess() {
    setLocking(true);
    setError(null);
    const result = await sendAction({ type: "LOCK_GUESS" });
    if (!result.ok && result.error) setError(result.error);
    setLocking(false);
  }

  if (!round) {
    return (
      <Card>
        <CardBody>
          <p className={styles.statusLine}>{state.status === "finished" ? "Game finished." : "Waiting for the round to load…"}</p>
        </CardBody>
      </Card>
    );
  }

  const markers: MapMarker[] = [];
  if (revealed && state.roundResult) {
    markers.push({ id: "target", x: state.roundResult.targetX, y: state.roundResult.targetY, color: "target", label: "TARGET" });
    markers.push({ id: role, x: state.roundResult.guesses[role].x, y: state.roundResult.guesses[role].y, color: MARKER_COLOR[role], label: "YOU" });
    markers.push({
      id: otherTeam,
      x: state.roundResult.guesses[otherTeam].x,
      y: state.roundResult.guesses[otherTeam].y,
      color: MARKER_COLOR[otherTeam],
      label: TEAM_LABEL[otherTeam],
    });
  } else if (myGuess) {
    markers.push({ id: role, x: myGuess.x, y: myGuess.y, color: MARKER_COLOR[role], pulse: !myLocked });
  }

  return (
    <div className={styles.wrap}>
      <Card variant="raised">
        <CardBody>
          <AnimatedScoreDisplay teamAName="Team A" teamAScore={state.scores.TEAM_A} teamBName="Team B" teamBScore={state.scores.TEAM_B} />
        </CardBody>
      </Card>

      {error && <p className={styles.errorBanner}>{readableGeoError(error.code, error.message)}</p>}

      <Card>
        <CardBody>
          <div className={styles.roundHeader}>
            <p className={styles.roundLabel}>ROUND {state.currentRoundIndex + 1}</p>
            {!revealed && round.question && <p className={styles.question}>{round.question}</p>}
            {!revealed && <p className={styles.instruction}>{myGuess ? "Tap the map to move your guess" : "Tap the map to place your guess"}</p>}
          </div>
          <ClickableImageMap
            imageUrl={round.imageUrl}
            alt={round.title || `Round ${state.currentRoundIndex + 1} map`}
            markers={markers}
            onPick={!revealed && !myLocked ? placeGuess : undefined}
            disabled={myLocked}
            empty={!round.imageUrl}
          />
        </CardBody>
      </Card>

      {!revealed && (
        <div className={styles.actionRow}>
          {!myLocked ? (
            <Button size="lg" fullWidth disabled={!myGuess || placing} loading={locking} onClick={() => void lockGuess()}>
              LOCK GUESS
            </Button>
          ) : (
            <div className={styles.lockedBlock}>
              <Badge variant={MARKER_COLOR[role]} dot>
                GUESS LOCKED
              </Badge>
              <p className={styles.statusLine}>{otherLocked ? "Revealing…" : `Waiting for ${TEAM_LABEL[otherTeam]}…`}</p>
            </div>
          )}
        </div>
      )}

      {revealed && state.roundResult && (
        <Card variant="raised">
          <CardBody>
            <RoundResultSummary role={role} result={state.roundResult} />
            <p className={styles.statusLine}>Waiting for the host to continue…</p>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function RoundResultSummary({ role, result }: { role: "TEAM_A" | "TEAM_B"; result: NonNullable<GeoGuessrState["roundResult"]> }) {
  const won = result.roundWinner === role;
  const tie = result.roundWinner === "TIE";
  return (
    <div className={styles.resultBlock}>
      <p className={[styles.resultHeadline, won && styles.resultWin, !won && !tie && styles.resultLoss].filter(Boolean).join(" ")}>
        {tie ? "ROUND TIED" : won ? "YOU WIN THE ROUND" : `${TEAM_LABEL[result.roundWinner as "TEAM_A" | "TEAM_B"]} WINS THE ROUND`}
      </p>
      <div className={styles.distanceRow}>
        <span>Team A — {formatDistance(result.distances.TEAM_A)}</span>
        <span>Team B — {formatDistance(result.distances.TEAM_B)}</span>
      </div>
    </div>
  );
}
