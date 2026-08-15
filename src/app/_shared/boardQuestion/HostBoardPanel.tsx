"use client";

import { useState } from "react";
import type { BoardQuestionState } from "@/domain/game/boardQuestion";
import { Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, QuestionPrompt } from "@/ui";
import { AnimatedScoreDisplay } from "./AnimatedScoreDisplay";
import { BoardGrid } from "./BoardGrid";
import { describeLastResult } from "./events";
import { readableGameError } from "./gameErrorMessages";
import styles from "./HostBoardPanel.module.css";

export interface HostBoardPanelProps {
  state: BoardQuestionState;
  lastEvents: unknown[];
  sendAction: (action: Record<string, unknown>) => Promise<{ ok: boolean; error?: { code: string; message: string } }>;
}

type PendingAction = "SELECT_QUESTION" | "JUDGE_CORRECT" | "JUDGE_INCORRECT" | "CLOSE_QUESTION" | "END_GAME" | null;

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
                ? `Game over — ${state.winner === "TIE" ? "tie" : `${state.winner} wins`}`
                : undefined
            }
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

      {error && <p className={styles.errorBanner}>{readableGameError(error.code, error.message)}</p>}
      {!error && lastResult && <p className={styles.resultBanner}>{lastResult}</p>}

      <Card>
        <CardHeader
          title="Board"
          subtitle={state.status === "finished" ? "Game finished" : "Click a question to reveal it"}
        />
        <CardBody>
          <BoardGrid
            state={state}
            onSelect={(questionId) => void act("SELECT_QUESTION", { type: "SELECT_QUESTION", questionId })}
          />
        </CardBody>
      </Card>

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
                <Badge variant="neutral">Waiting for a buzz…</Badge>
                {state.attemptedTeams.length > 0 && (
                  <p className={styles.hint}>{state.attemptedTeams.join(", ")} already tried — steal is open.</p>
                )}
              </div>
            )}

            {/* ÉTAT 3 — a team buzzed, no answer submitted yet */}
            {state.phase === "answering" && state.submittedAnswer === null && (
              <div className={styles.statusBlock}>
                <p className={[styles.bigBuzz, styles[teamVariant]].join(" ")}>{state.buzzedTeam} BUZZED</p>
                <p className={styles.hint}>Waiting on their answer…</p>
              </div>
            )}

            {/* ÉTAT 4 — answer submitted, ready to judge */}
            {state.phase === "answering" && state.submittedAnswer !== null && (
              <div className={styles.statusBlock}>
                <Badge variant={teamVariant}>{state.buzzedTeam} answers</Badge>
                <p className={styles.submittedAnswer}>&ldquo;{state.submittedAnswer}&rdquo;</p>
                <div className={styles.judgeRow}>
                  <Button
                    size="lg"
                    loading={pending === "JUDGE_CORRECT"}
                    disabled={pending !== null}
                    onClick={() => void act("JUDGE_CORRECT", { type: "JUDGE_ANSWER", correct: true })}
                  >
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
          </CardBody>
        </Card>
      )}

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
