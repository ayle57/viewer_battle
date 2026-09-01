"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { useReducedMotionSafe } from "@/app/_shared/motion/useReducedMotionSafe";
import { fadeUp } from "@/app/_shared/motion/variants";
import type { GuessThePriceState } from "@/domain/game/guessThePrice";
import { AnimatedScoreDisplay } from "@/app/_shared/boardQuestion/AnimatedScoreDisplay"; // generic (ScoreDisplayProps-only) despite the folder name — same cross-engine reuse SteamRatingsEngine's own HostSteamPanel already relies on
import { Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, ImageWithFallback } from "@/ui";
import { readableGuessThePriceError } from "./gameErrorMessages";
import styles from "./HostPricePanel.module.css";

export interface HostPricePanelProps {
  state: GuessThePriceState;
  sendAction: (action: Record<string, unknown>) => Promise<{ ok: boolean; error?: { code: string; message: string } }>;
}

const TEAM_LABEL: Record<"TEAM_A" | "TEAM_B", string> = { TEAM_A: "Team A", TEAM_B: "Team B" };

type PendingAction = "JUDGE_CORRECT" | "JUDGE_INCORRECT" | "SKIP_ROUND" | "NEXT_ROUND" | "END_GAME" | null;

function formatPrice(price: number): string {
  return `€${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * The host's control surface — the buzzer-race half is MusicEngine's own
 * HostMusicPanel shape (BUZZ -> SUBMIT_ANSWER -> JUDGE_ANSWER, a steal on
 * a wrong judgment): the instant a team buzzes and submits a guess, it
 * shows up right here — the Host never auto-judges off `marginPercent`
 * (types.ts's own top comment: a hard threshold would be the wrong call,
 * the Host always has the final word), they just get every number laid
 * out together (the real `price`, the optional `marginPercent` — "il
 * faut qu'il puisse mettre la marge de prix seul si il veut en mettre
 * une" — and the team's own `submittedGuess`) to make that call fast.
 * What's genuinely different from SteamRatingsEngine: there's no
 * progressive reveal to pace — the item (photo + title) is shown to
 * everyone the instant the round starts.
 */
export function HostPricePanel({ state, sendAction }: HostPricePanelProps) {
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

      {error && <p className={styles.errorBanner}>{readableGuessThePriceError(error.code, error.message)}</p>}
      {!error && !revealed && lastResult && <p className={styles.resultBanner}>{lastResult}</p>}

      {round && (
        <motion.div key={state.currentRoundIndex} initial="hidden" animate="show" variants={fadeUp(reduced, { y: 14, duration: 0.4 })}>
          <p className={styles.roundLabel}>
            ITEM {state.currentRoundIndex + 1} / {state.rounds.length}
          </p>
          <Card>
            <CardHeader title={round.title ?? `Item ${state.currentRoundIndex + 1}`} />
            <CardBody>
              {round.imageUrl && <ImageWithFallback src={round.imageUrl} alt="" className={styles.itemImage} />}

              <div className={styles.answerKey}>
                <span className={styles.answerKeyLabel}>Answer key — only you see this now</span>
                <p className={styles.answerKeyPrice}>{round.price !== null ? formatPrice(round.price) : "—"}</p>
                {round.marginPercent !== null && <p className={styles.answerKeyMargin}>±{round.marginPercent}% counts as close enough</p>}
              </div>

              {state.phase === "guessing" && (
                <div className={styles.statusBlock}>
                  <Badge variant="neutral">Waiting for a buzz…</Badge>
                  {state.attemptedTeams.length > 0 && (
                    <p className={styles.hint}>{state.attemptedTeams.map((t) => TEAM_LABEL[t]).join(", ")} already tried — steal is open.</p>
                  )}
                </div>
              )}

              {state.phase === "answering" && state.submittedGuess === null && (
                <div className={styles.statusBlock}>
                  <p className={[styles.bigBuzz, styles[teamVariant]].join(" ")}>{state.buzzedTeam && TEAM_LABEL[state.buzzedTeam]} BUZZED</p>
                  <p className={styles.hint}>Waiting on their guess…</p>
                </div>
              )}

              {state.phase === "answering" && state.submittedGuess !== null && (
                <div className={styles.statusBlock}>
                  <Badge variant={teamVariant}>{state.buzzedTeam && TEAM_LABEL[state.buzzedTeam]} guessed</Badge>
                  <p className={styles.submittedGuess}>{formatPrice(state.submittedGuess)}</p>
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
                    The price was: <strong>{round.price !== null ? formatPrice(round.price) : "—"}</strong>
                  </p>
                  {state.status !== "finished" && (
                    <Button size="lg" fullWidth loading={pending === "NEXT_ROUND"} disabled={pending !== null} onClick={() => void act("NEXT_ROUND", { type: "NEXT_ROUND" })}>
                      Next item →
                    </Button>
                  )}
                </div>
              )}

              {(state.phase === "guessing" || state.phase === "answering") && (
                <div className={styles.closeRow}>
                  <Button variant="ghost" size="sm" loading={pending === "SKIP_ROUND"} disabled={pending !== null} onClick={() => void act("SKIP_ROUND", { type: "SKIP_ROUND" })}>
                    Skip item (no winner)
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
function lastRoundWinner(state: GuessThePriceState): "TEAM_A" | "TEAM_B" | "TIE" {
  const last = state.history[state.history.length - 1];
  return last?.wonBy ?? "TIE";
}

/** A short "Team A won the last item" line shown while the NEXT item is already underway — same "what just happened" reminder SteamRatingsEngine's own HostSteamPanel provides. */
function lastRoundResult(state: GuessThePriceState): string | null {
  if (state.currentRoundIndex === 0 && state.history.length === 0) return null;
  const last = state.history[state.history.length - 1];
  if (!last) return null;
  return last.wonBy ? `${TEAM_LABEL[last.wonBy]} won the last item.` : "Nobody got the last item.";
}
