"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { useReducedMotionSafe } from "@/app/_shared/motion/useReducedMotionSafe";
import { fadeUp } from "@/app/_shared/motion/variants";
import type { GeoGuessrState } from "@/domain/game/geoGuessr";
import { AnimatedScoreDisplay } from "@/app/_shared/boardQuestion/AnimatedScoreDisplay"; // generic (ScoreDisplayProps-only) despite the folder name — see PlayerGeoPanel's identical reuse
import { Badge, Button, Card, CardBody, CardHeader, ClickableImageMap, ConfirmDialog, type MapMarker } from "@/ui";
import { readableGeoError } from "./gameErrorMessages";
import { formatDistance } from "./format";
import { CountdownControl } from "@/app/_shared/CountdownControl";
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
  const reduced = useReducedMotionSafe(); // hydration-safe — see that hook's own doc comment
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
  const isLastRound = state.currentRoundIndex >= state.rounds.length - 1;

  const markers: MapMarker[] = [];
  if (revealed && state.roundResult) {
    markers.push({ id: "target", x: state.roundResult.targetX, y: state.roundResult.targetY, color: "target", label: "TARGET" });
    // A `null` guess (only reachable via a countdown forcing the round
    // closed with zero proposals queued — GeoRoundResult's own doc
    // comment) has no real spot to mark.
    if (state.roundResult.guesses.TEAM_A) {
      markers.push({ id: "TEAM_A", x: state.roundResult.guesses.TEAM_A.x, y: state.roundResult.guesses.TEAM_A.y, color: "teamA", label: "A" });
    }
    if (state.roundResult.guesses.TEAM_B) {
      markers.push({ id: "TEAM_B", x: state.roundResult.guesses.TEAM_B.x, y: state.roundResult.guesses.TEAM_B.y, color: "teamB", label: "B" });
    }
  } else {
    // HOST always gets the raw, unredacted state (this component's own
    // doc comment) — so every candidate EITHER team has proposed is
    // visible here, not just one shared pin per team (see
    // GeoGuessrState.proposals' own doc comment on why placing is now
    // per-proposal, not per-team). Once a team actually LOCKS, its
    // `guesses[team]` entry is set and collapses that team's markers
    // down to the one real, final spot — same "A"/"B" label the reveal
    // markers above already use, for visual continuity.
    (["TEAM_A", "TEAM_B"] as const).forEach((team) => {
      const color = team === "TEAM_A" ? "teamA" : "teamB";
      const locked = state.guesses[team];
      if (locked) {
        markers.push({ id: team, x: locked.x, y: locked.y, color, label: team === "TEAM_A" ? "A" : "B" });
      } else {
        // Coordinate-based id, not index-based — see PlayerGeoPanel's
        // identical fix/comment: an index-keyed marker slides to a new
        // spot instead of popping in fresh when the oldest proposal
        // drops off (MAX_PLAYERS_PER_TEAM) and every later one shifts
        // down a slot. Label is the proposer's own FULL name (marker
        // COLOR already distinguishes the team, same as everywhere else
        // on this panel — no need to also spell the team letter into
        // the label itself) — see PlayerGeoPanel's identical change and
        // its own comment on the real 2-letter-initials collision bug
        // this replaced ("SA"/"SA" for two different teammates).
        state.proposals[team].forEach((spot) => {
          markers.push({ id: `${team}-${spot.x}-${spot.y}`, x: spot.x, y: spot.y, color, label: spot.byName });
        });
      }
    });
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
          {/* On the last round, expiry genuinely ends the whole game
              (resolveExpiredCountdown's own doc comment, engine.ts) —
              the label says so plainly instead of "End round in" being
              technically-true-but-misleading right when it matters
              most. */}
          <CountdownControl
            deadlineMs={state.countdownDeadline}
            idleLabel={isLastRound ? "End game in" : "End round in"}
            activeLabel={isLastRound ? "Game ends in" : "Round ends in"}
            onStart={(durationMs) => sendAction({ type: "START_COUNTDOWN", durationMs })}
            onCancel={() => sendAction({ type: "CANCEL_COUNTDOWN" })}
            readError={readableGeoError}
          />
          <Button variant="danger" size="sm" disabled={pending !== null} onClick={() => setEndGameOpen(true)}>
            End game
          </Button>
        </div>
      )}

      {error && <p className={styles.errorBanner}>{readableGeoError(error.code, error.message)}</p>}

      {/* "ROUND 03 / 12" — the one fact missing before this pass: the Host
          could see WHICH round's question/map was up, but never how many
          were left in the show. `state.rounds.length` is never redacted
          (see view.ts's toPublicView — only individual future rounds'
          FIELDS are blanked, the array's own length isn't), same total a
          Player/Display already reads for their own round labels. */}
      {/* `key={currentRoundIndex}` — a real round change re-enters this
          block once (item 10/17), never a loop, never what decides a
          round actually changed (still purely `state.currentRoundIndex`,
          moved only by the server's own NEXT_ROUND broadcast). */}
      {round && (
        <motion.div key={state.currentRoundIndex} initial="hidden" animate="show" variants={fadeUp(reduced, { y: 14, duration: 0.4 })}>
          <p className={styles.roundLabel}>
            ROUND {state.currentRoundIndex + 1} / {state.rounds.length}
          </p>
          <Card>
            <CardHeader
              title={round.question || `Round ${state.currentRoundIndex + 1}`}
              subtitle={revealed ? "Revealed — ready for the next round" : "Target hidden until both teams lock"}
            />
            <CardBody>
              <ClickableImageMap
                imageUrl={round.imageUrl}
                alt={round.title || `Round ${state.currentRoundIndex + 1} map`}
                markers={markers}
                empty={!round.imageUrl}
                emptyLabel="This round's map is unavailable right now."
              />
            </CardBody>
          </Card>
        </motion.div>
      )}

      {/* Team status AFTER the map, not before — "what am I looking at,
          then who's locked" is the order a Host actually reads the
          screen in (item 1's hierarchy), not the reverse. */}
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

      {revealed && state.roundResult && (
        <motion.div initial="hidden" animate="show" variants={fadeUp(reduced)}>
        <Card variant="raised">
          <CardBody>
            <div className={styles.resultBlock}>
              {/* A REAL, REPRODUCED UX gap this closes: the Player and
                  Display reveal both color this exact headline in the
                  actual winning team's color (a real, requested fix,
                  earlier this session) — the Host's own version was
                  still flat, uncolored text, the one screen where "is
                  the winner immediately identifiable" (this pass's own
                  audit question) genuinely read NO at a glance.
                  Reuses the identical pattern, not a new one — same
                  team-color-on-the-headline idea PlayerGeoPanel/
                  DisplayGeoPanel already established. */}
              <p
                className={[
                  styles.resultHeadline,
                  state.roundResult.roundWinner === "TEAM_A" && styles.resultTeamA,
                  state.roundResult.roundWinner === "TEAM_B" && styles.resultTeamB,
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
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
        </motion.div>
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

// The countdown-to-resolve controls used to be defined here, private to
// this file — now `@/app/_shared/CountdownControl` (shared with
// BoardQuestion's own HostBoardPanel, see that component's own doc
// comment for why this was generalized instead of copy-pasted a second
// time).
