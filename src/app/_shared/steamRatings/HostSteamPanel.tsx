"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { useReducedMotionSafe } from "@/app/_shared/motion/useReducedMotionSafe";
import { fadeUp } from "@/app/_shared/motion/variants";
import type { SteamRatingsState } from "@/domain/game/steamRatings";
import { AnimatedScoreDisplay } from "@/app/_shared/boardQuestion/AnimatedScoreDisplay"; // generic (ScoreDisplayProps-only) despite the folder name — same cross-engine reuse MusicEngine's own HostMusicPanel already relies on
import { Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, ImageWithFallback } from "@/ui";
import { readableSteamRatingsError } from "./gameErrorMessages";
import styles from "./HostSteamPanel.module.css";

export interface HostSteamPanelProps {
  state: SteamRatingsState;
  sendAction: (action: Record<string, unknown>) => Promise<{ ok: boolean; error?: { code: string; message: string } }>;
}

const TEAM_LABEL: Record<"TEAM_A" | "TEAM_B", string> = { TEAM_A: "Team A", TEAM_B: "Team B" };

type PendingAction = "REVEAL_NEXT_RATING" | "JUDGE_CORRECT" | "JUDGE_INCORRECT" | "SKIP_ROUND" | "NEXT_ROUND" | "END_GAME" | null;

/**
 * The host's control surface — the buzzer-race half is BoardQuestion's
 * own HostBoardPanel shape, but with ORAL answers, not typed ("finalement
 * les reponses du guess the game seront orales," a deliberate reversal
 * of the first pass's Music-style SUBMIT_ANSWER step — see
 * src/domain/game/steamRatings/types.ts's top comment): the instant a
 * team buzzes, the Host hears their guess live off-app and judges
 * Correct/Incorrect directly, no "waiting on their answer" step and
 * nothing typed ever shown on screen. A wrong answer still opens a real
 * steal for the other team. The one thing genuinely new to this game:
 * the Host's own ratings list, shown IN FULL (unlike every other role,
 * whose view is sliced to `revealedCount`) with a "Reveal next rating"
 * button that climbs through it one at a time — "je ferai le reste...
 * animation dans OBS": this panel's only job is exposing which ratings
 * are live right now, not animating their entrance (that's the Host's
 * own OBS layering on top). HOST always gets the real, unredacted
 * `title`/`imageUrl` (the "answer key" block below) — same posture as
 * MusicEngine's Host-only title/artist, shown here even before reveal so
 * the Host can actually judge a spoken guess against it.
 */
export function HostSteamPanel({ state, sendAction }: HostSteamPanelProps) {
  const reduced = useReducedMotionSafe(); // hydration-safe — see that hook's own doc comment
  const [pending, setPending] = useState<PendingAction>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [endGameOpen, setEndGameOpen] = useState(false);

  async function act(kind: PendingAction, action: Record<string, unknown>) {
    setPending(kind);
    setError(null);
    const result = await sendAction(action);
    if (!result.ok && result.error) setError(result.error);
    setPending(null);
  }

  const round = state.rounds[state.currentRoundIndex];
  const revealed = state.phase === "revealed";
  const teamVariant = state.buzzedTeam === "TEAM_A" ? "teamA" : state.buzzedTeam === "TEAM_B" ? "teamB" : "neutral";
  const lastResult = state.status === "finished" ? null : lastRoundResult(state);
  const canRevealMore = round !== undefined && state.revealedCount < round.ratings.length;

  return (
    <div className={styles.wrap}>
      <Card variant="raised">
        <CardBody>
          <AnimatedScoreDisplay
            teamAName="Team A"
            teamAScore={state.scores.TEAM_A}
            teamBName="Team B"
            teamBScore={state.scores.TEAM_B}
            label={state.status === "finished" ? `Game over — ${state.winner === "TIE" ? "tie" : `${TEAM_LABEL[state.winner as "TEAM_A" | "TEAM_B"]} wins`}` : undefined}
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

      {error && <p className={styles.errorBanner}>{readableSteamRatingsError(error.code, error.message)}</p>}
      {!error && !revealed && lastResult && <p className={styles.resultBanner}>{lastResult}</p>}

      {round && (
        <motion.div key={state.currentRoundIndex} initial="hidden" animate="show" variants={fadeUp(reduced, { y: 14, duration: 0.4 })}>
          <p className={styles.roundLabel}>
            GAME {state.currentRoundIndex + 1} / {state.rounds.length}
          </p>
          <Card>
            <CardHeader title={round.title ?? `Game ${state.currentRoundIndex + 1}`} />
            <CardBody>
              {round.imageUrl && (
                <div className={styles.answerKey}>
                  <ImageWithFallback src={round.imageUrl} alt="" className={styles.answerKeyImage} />
                  <span className={styles.answerKeyLabel}>Answer key — only you see this now</span>
                </div>
              )}

              <div className={styles.ratingsList}>
                {round.ratings.map((text, index) => {
                  const isRevealed = index < state.revealedCount;
                  return (
                    <div key={index} className={[styles.ratingRow, isRevealed ? styles.ratingRevealed : styles.ratingHidden].join(" ")}>
                      <span className={styles.ratingNumber}>{index + 1}</span>
                      <span className={styles.ratingText}>{isRevealed ? text : "···"}</span>
                      {isRevealed && (
                        <span className={styles.ratingRevealedTag} aria-hidden="true">
                          LIVE
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              {state.phase === "guessing" && (
                <Button
                  size="lg"
                  fullWidth
                  loading={pending === "REVEAL_NEXT_RATING"}
                  disabled={pending !== null || !canRevealMore}
                  onClick={() => void act("REVEAL_NEXT_RATING", { type: "REVEAL_NEXT_RATING" })}
                >
                  {state.revealedCount === 0 ? "▶ Reveal the first rating" : canRevealMore ? "▶ Reveal next rating" : "All ratings revealed"}
                </Button>
              )}

              {state.phase === "guessing" && (
                <div className={styles.statusBlock}>
                  <Badge variant="neutral">{state.revealedCount === 0 ? "Nothing revealed yet" : "Waiting for a buzz…"}</Badge>
                  {state.attemptedTeams.length > 0 && (
                    <p className={styles.hint}>{state.attemptedTeams.map((t) => TEAM_LABEL[t]).join(", ")} already tried — steal is open.</p>
                  )}
                </div>
              )}

              {state.phase === "answering" && (
                <div className={styles.statusBlock}>
                  <p className={[styles.bigBuzz, styles[teamVariant]].join(" ")}>{state.buzzedTeam && TEAM_LABEL[state.buzzedTeam]} BUZZED</p>
                  <p className={styles.hint}>Answering out loud — judge once you&apos;ve heard it.</p>
                  <div className={styles.judgeRow}>
                    <Button size="lg" loading={pending === "JUDGE_CORRECT"} disabled={pending !== null} onClick={() => void act("JUDGE_CORRECT", { type: "JUDGE_ANSWER", correct: true })}>
                      ✓ Correct
                    </Button>
                    <Button
                      size="lg"
                      variant="secondary"
                      loading={pending === "JUDGE_INCORRECT"}
                      disabled={pending !== null}
                      onClick={() => void act("JUDGE_INCORRECT", { type: "JUDGE_ANSWER", correct: false })}
                    >
                      ✕ Incorrect
                    </Button>
                  </div>
                </div>
              )}

              {revealed && (
                <div className={styles.resultBlock}>
                  <p
                    className={[styles.resultHeadline, lastRoundWinner(state) === "TEAM_A" && styles.resultTeamA, lastRoundWinner(state) === "TEAM_B" && styles.resultTeamB]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {lastRoundWinner(state) === "TIE" ? "NOBODY GOT IT" : `${TEAM_LABEL[lastRoundWinner(state) as "TEAM_A" | "TEAM_B"]} WINS THE ROUND`}
                  </p>
                  <p className={styles.answerReveal}>
                    That was: <strong>{round.title}</strong>
                  </p>
                  {state.status !== "finished" && (
                    <Button size="lg" fullWidth loading={pending === "NEXT_ROUND"} disabled={pending !== null} onClick={() => void act("NEXT_ROUND", { type: "NEXT_ROUND" })}>
                      Next game →
                    </Button>
                  )}
                </div>
              )}

              {(state.phase === "guessing" || state.phase === "answering") && state.revealedCount > 0 && (
                <div className={styles.closeRow}>
                  <Button variant="ghost" size="sm" loading={pending === "SKIP_ROUND"} disabled={pending !== null} onClick={() => void act("SKIP_ROUND", { type: "SKIP_ROUND" })}>
                    Skip game (no winner)
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
        description="Whatever round is in progress is abandoned — nobody wins it. The winner is whoever's ahead right now, or a tie if the scores are even."
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

/** The most recently closed round's winner, straight from `history` — used only once `phase === "revealed"`, when the current round's own outcome is always the LAST entry (closeRound just appended it, engine.ts). */
function lastRoundWinner(state: SteamRatingsState): "TEAM_A" | "TEAM_B" | "TIE" {
  const last = state.history[state.history.length - 1];
  return last?.wonBy ?? "TIE";
}

/** A short "Team A won the last game" line shown while the NEXT game is already underway — same "what just happened" reminder MusicEngine's own HostMusicPanel provides. */
function lastRoundResult(state: SteamRatingsState): string | null {
  if (state.currentRoundIndex === 0 && state.history.length === 0) return null;
  const last = state.history[state.history.length - 1];
  if (!last) return null;
  return last.wonBy ? `${TEAM_LABEL[last.wonBy]} won the last game.` : "Nobody got the last game.";
}
