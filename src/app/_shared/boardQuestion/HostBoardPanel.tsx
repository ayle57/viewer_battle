"use client";

import { useState } from "react";
import type { BoardQuestionState } from "@/domain/game/boardQuestion";
import { Button, Card, CardBody, CardHeader, ConfirmDialog, QuestionPrompt } from "@/ui";
import { AnimatedScoreDisplay } from "./AnimatedScoreDisplay";
import { BoardGrid } from "./BoardGrid";
import { describeLastResult } from "./events";
import { readableGameError } from "./gameErrorMessages";
import { CountdownControl } from "@/app/_shared/CountdownControl";
import { JudgeRow } from "@/app/_shared/JudgeRow";
import { RoundStatus } from "@/app/_shared/RoundStatus";
import styles from "./HostBoardPanel.module.css";

export interface HostBoardPanelProps {
  state: BoardQuestionState;
  lastEvents: unknown[];
  sendAction: (action: Record<string, unknown>) => Promise<{ ok: boolean; error?: { code: string; message: string } }>;
}

type PendingAction = "SELECT_QUESTION" | "JUDGE_CORRECT" | "JUDGE_INCORRECT" | "CLOSE_QUESTION" | "END_GAME" | null;

const TEAM_LABEL: Record<"TEAM_A" | "TEAM_B", string> = { TEAM_A: "Team A", TEAM_B: "Team B" };

/**
 * The host's control surface, built as the explicit state machine the
 * live show actually goes through — not a technical cockpit: pick a
 * question, wait for a buzz, wait for the answer, then two unmissable
 * buttons. Every click is a real game:action; `pending` disables the
 * button that was clicked (not the others) until the server acks it.
 *
 * "End game" (any phase, whenever the game isn't already finished) is
 * the one action here that doesn't come from the board's own state
 * machine — it's the host's own escape hatch, so it gets the same
 * `ConfirmDialog` treatment as "Forget this session" (host/page.tsx):
 * an explicit, danger-styled confirmation before the real `END_GAME`
 * action ever fires, since it's irreversible and ends the round for
 * everyone watching.
 */
export function HostBoardPanel({ state, lastEvents, sendAction }: HostBoardPanelProps) {
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

  const activeQuestion = state.questions.find((q) => q.id === state.activeQuestionId) ?? null;
  const category = activeQuestion ? state.categories.find((c) => c.id === activeQuestion.categoryId) : undefined;
  const lastResult = describeLastResult(lastEvents);
  const teamVariant = state.buzzedTeam === "TEAM_A" ? "teamA" : state.buzzedTeam === "TEAM_B" ? "teamB" : "neutral";

  return (
    <div className={styles.wrap}>
      <Card variant="raised">
        <CardBody>
          <AnimatedScoreDisplay
            teamAName="Team A"
            teamAScore={state.scores.TEAM_A}
            teamBName="Team B"
            teamBScore={state.scores.TEAM_B}
            label={
              state.status === "finished"
                ? `Game over — ${state.winner === "TIE" ? "tie" : `${TEAM_LABEL[state.winner as "TEAM_A" | "TEAM_B"]} wins`}`
                : undefined
            }
          />
        </CardBody>
      </Card>

      {state.status !== "finished" && (
        <div className={styles.endGameRow}>
          {/* Same shared control GeoGuessr's own HostGeoPanel uses (see
              src/domain/game/countdown.ts's own doc comment on why this
              is generalized, not GeoGuessr-only) — this engine has no
              smaller "round" unit to force-close, so expiring always
              just ends the game outright, the same rule "End game"
              itself uses. Wrapped in its own group, visually separated
              (a divider, see the CSS) from "End game" right next to it —
              a real, reported mix-up: the timer controls and the one
              genuinely destructive action here used to sit in the same
              undifferentiated row, at equal visual weight. */}
          <div className={styles.timerGroup}>
            <CountdownControl
              deadlineMs={state.countdownDeadline}
              idleLabel="End game in"
              activeLabel="Game ends in"
              onStart={(durationMs) => sendAction({ type: "START_COUNTDOWN", durationMs })}
              onCancel={() => sendAction({ type: "CANCEL_COUNTDOWN" })}
              readError={readableGameError}
            />
          </div>
          <div className={styles.dangerGroup}>
            <Button variant="danger" size="sm" disabled={pending !== null} onClick={() => setEndGameOpen(true)}>
              End game
            </Button>
          </div>
        </div>
      )}

      {error && <p className={styles.errorBanner}>{readableGameError(error.code, error.message)}</p>}
      {!error && lastResult && <p className={styles.resultBanner}>{lastResult}</p>}

      {/* The live question — STATE, then supporting info, then the one
          action that matters — sits ABOVE the board now, not below it.
          A real, audited gap this closes: with the board rendered first,
          the actual thing a Host needs to look at/act on while a
          question is live could sit below the fold, behind a full grid
          of now-secondary cells. */}
      {activeQuestion && (
        <Card variant="raised">
          <CardBody>
            <QuestionPrompt
              category={category?.name}
              points={activeQuestion.points}
              prompt={activeQuestion.prompt}
              answer={activeQuestion.answer}
            />

            {/* ÉTAT 2 — revealed, nobody has buzzed yet */}
            {state.phase === "revealed" && !state.buzzedTeam && (
              <div className={styles.statusBlock}>
                <RoundStatus>Waiting for a buzz</RoundStatus>
                {state.attemptedTeams.length > 0 && (
                  <p className={styles.hint}>
                    {state.attemptedTeams.map((t) => TEAM_LABEL[t]).join(", ")} already tried — steal is open.
                  </p>
                )}
              </div>
            )}

            {/* ÉTAT 3 — a team buzzed, no answer submitted yet */}
            {state.phase === "answering" && state.submittedAnswer === null && (
              <div className={styles.statusBlock}>
                <RoundStatus tone={teamVariant}>
                  {state.buzzedTeam && TEAM_LABEL[state.buzzedTeam]} buzzed
                </RoundStatus>
                <p className={styles.hint}>Waiting on their answer…</p>
              </div>
            )}

            {/* ÉTAT 4 — answer submitted, ready to judge. Same dominant
                treatment as ÉTAT 3, not a smaller Badge — this is the
                moment a decision is actually expected, so its own status
                line shouldn't visually shrink right when that matters
                most (a real, audited inconsistency this pass fixes). */}
            {state.phase === "answering" && state.submittedAnswer !== null && (
              <div className={styles.statusBlock}>
                <RoundStatus tone={teamVariant}>
                  {state.buzzedTeam && TEAM_LABEL[state.buzzedTeam]} answered — your call
                </RoundStatus>
                <p className={styles.submittedAnswer}>&ldquo;{state.submittedAnswer}&rdquo;</p>
                <JudgeRow
                  onCorrect={() => void act("JUDGE_CORRECT", { type: "JUDGE_ANSWER", correct: true })}
                  onIncorrect={() => void act("JUDGE_INCORRECT", { type: "JUDGE_ANSWER", correct: false })}
                  correctLoading={pending === "JUDGE_CORRECT"}
                  incorrectLoading={pending === "JUDGE_INCORRECT"}
                  disabled={pending !== null}
                />
              </div>
            )}

            {/* Hidden once an answer's already in and waiting on nothing
                but the judgment above — "no winner" isn't a real option
                anymore at that point, only Correct/Incorrect are, so
                offering it here read as a redundant third button right
                next to the two that actually matter. Still available in
                every phase BEFORE that (nobody's buzzed yet, or someone
                buzzed but hasn't answered) — a genuine "abandon this
                question" escape hatch while there's still no answer on
                the table to judge. */}
            {!(state.phase === "answering" && state.submittedAnswer !== null) && (
              <div className={styles.closeRow}>
                <Button
                  variant="ghost"
                  size="sm"
                  loading={pending === "CLOSE_QUESTION"}
                  disabled={pending !== null}
                  onClick={() => void act("CLOSE_QUESTION", { type: "CLOSE_QUESTION" })}
                >
                  Close question (no winner)
                </Button>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {/* Recedes to `variant="subtle"` once a question is live — still
          there for "what's left on the board" context, but no longer
          competing for attention with the actual live question above
          it. Full weight again once nothing's active (the Host's own
          next real decision). */}
      <Card variant={activeQuestion ? "subtle" : "default"}>
        <CardHeader
          title="Board"
          subtitle={
            state.status === "finished"
              ? "Game finished"
              : activeQuestion
                ? "Pick the next question once this one closes"
                : "Click a question to reveal it"
          }
        />
        <CardBody>
          <BoardGrid
            state={state}
            onSelect={(questionId) => void act("SELECT_QUESTION", { type: "SELECT_QUESTION", questionId })}
          />
        </CardBody>
      </Card>

      <ConfirmDialog
        open={endGameOpen}
        title="End this game now?"
        description="Whatever question is in progress is abandoned — nobody wins it. The winner is whoever's ahead right now, or a tie if the scores are even."
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
