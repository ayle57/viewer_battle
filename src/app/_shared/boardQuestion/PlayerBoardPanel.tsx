"use client";

import { useState } from "react";
import type { BoardQuestionState } from "@/domain/game/boardQuestion";
import { AnswerInput, BuzzButton, Card, CardBody, QuestionPrompt, ScoreDisplay } from "@/ui";
import { BoardGrid } from "./BoardGrid";
import { describeLastResult, lastJudgment } from "./events";
import { readableGameError } from "./gameErrorMessages";
import styles from "./PlayerBoardPanel.module.css";

export interface PlayerBoardPanelProps {
  state: BoardQuestionState;
  role: "TEAM_A" | "TEAM_B";
  lastEvents: unknown[];
  sendAction: (action: Record<string, unknown>) => Promise<{ ok: boolean; error?: { code: string; message: string } }>;
}

const TEAM_LABEL: Record<"TEAM_A" | "TEAM_B", string> = { TEAM_A: "TEAM A", TEAM_B: "TEAM B" };

/**
 * The player's view: read-only board (only the host selects), a big buzz
 * moment when it's genuinely available, a real answer field once your
 * team buzzed, and a plain-language reason when neither applies (never
 * just a blank screen) — see AGENTS.md's redaction rule for why
 * `state.questions[].answer` is already empty here regardless of
 * anything this component does; it has nothing to hide because the
 * server never sent it anything to hide. `state.submittedAnswer` is NOT
 * redacted the same way — it's visible to every role once sent (the
 * broadcast equivalent of saying it out loud on stream), so both teams
 * see exactly what was answered while the host is judging it.
 */
export function PlayerBoardPanel({ state, role, lastEvents, sendAction }: PlayerBoardPanelProps) {
  const [buzzing, setBuzzing] = useState(false);
  const [answering, setAnswering] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);

  async function buzz() {
    setBuzzing(true);
    setError(null);
    const result = await sendAction({ type: "BUZZ" });
    if (!result.ok && result.error) setError(result.error);
    setBuzzing(false);
  }

  async function submitAnswer(text: string) {
    setAnswering(true);
    setError(null);
    const result = await sendAction({ type: "SUBMIT_ANSWER", text });
    if (!result.ok && result.error) setError(result.error);
    setAnswering(false);
  }

  const activeQuestion = state.questions.find((q) => q.id === state.activeQuestionId) ?? null;
  const category = activeQuestion ? state.categories.find((c) => c.id === activeQuestion.categoryId) : undefined;
  const judgment = state.buzzedTeam === null ? lastJudgment(lastEvents) : null; // only show it once the floor has actually moved on
  const otherResult = !judgment ? describeLastResult(lastEvents) : null; // e.g. "Question closed — nobody got it."
  const variant = role === "TEAM_A" ? "teamA" : "teamB";
  const otherTeam = role === "TEAM_A" ? "TEAM_B" : "TEAM_A";

  const canBuzz = state.phase === "revealed" && !state.attemptedTeams.includes(role);
  const isSteal = state.attemptedTeams.length > 0;
  const otherTeamAlreadyOut = state.attemptedTeams.includes(otherTeam);
  const myTeamAlreadyOut = state.attemptedTeams.includes(role) && state.buzzedTeam !== role;
  const itsMyTurn = state.buzzedTeam === role;
  const iSubmitted = itsMyTurn && state.submittedAnswer !== null;

  return (
    <div className={styles.wrap}>
      <Card variant="raised">
        <CardBody>
          <ScoreDisplay teamAName="Team A" teamAScore={state.scores.TEAM_A} teamBName="Team B" teamBScore={state.scores.TEAM_B} />
        </CardBody>
      </Card>

      {error && <p className={styles.errorBanner}>{readableGameError(error.code, error.message)}</p>}
      {!error && judgment && (
        <p className={[styles.judgmentBanner, judgment.correct ? styles.correct : styles.incorrect].join(" ")}>
          {judgment.correct ? "CORRECT" : "INCORRECT"}
        </p>
      )}
      {!error && !judgment && otherResult && <p className={styles.resultBanner}>{otherResult}</p>}

      <Card>
        <CardBody>
          <BoardGrid state={state} />
        </CardBody>
      </Card>

      {activeQuestion ? (
        <Card variant="raised">
          <CardBody>
            <QuestionPrompt category={category?.name} points={activeQuestion.points} prompt={activeQuestion.prompt} />
            <div className={styles.buzzArea}>
              {itsMyTurn && !iSubmitted && (
                <>
                  <p className={[styles.statusLine, styles.myTurn].join(" ")}>YOU BUZZED</p>
                  <p className={styles.answerLabel}>Your answer</p>
                </>
              )}
              {itsMyTurn && (
                <AnswerInput
                  onSubmit={(text) => void submitAnswer(text)}
                  pending={answering}
                  submitted={iSubmitted}
                  submitLabel="SEND ANSWER"
                />
              )}
              {itsMyTurn && iSubmitted && <p className={styles.statusLine}>ANSWER SENT</p>}

              {state.buzzedTeam && !itsMyTurn && (
                <div className={styles.otherTeamAnswering}>
                  <p className={styles.statusLine}>{TEAM_LABEL[state.buzzedTeam]} IS ANSWERING</p>
                  {state.submittedAnswer !== null && (
                    <p className={styles.theirAnswer}>&ldquo;{state.submittedAnswer}&rdquo;</p>
                  )}
                </div>
              )}

              {!state.buzzedTeam && canBuzz && (
                <>
                  <p className={styles.statusLine}>{isSteal ? "YOU CAN STEAL" : "Gotta be quick!"}</p>
                  <BuzzButton variant={variant} pending={buzzing} onClick={() => void buzz()} />
                </>
              )}

              {!state.buzzedTeam && !canBuzz && myTeamAlreadyOut && !otherTeamAlreadyOut && (
                <p className={styles.statusLine}>You already buzzed — {TEAM_LABEL[otherTeam]} can steal now.</p>
              )}
              {!state.buzzedTeam && !canBuzz && myTeamAlreadyOut && otherTeamAlreadyOut && (
                <p className={styles.statusLine}>Both teams have tried this question.</p>
              )}
            </div>
          </CardBody>
        </Card>
      ) : (
        <p className={styles.statusLine}>
          {state.status === "finished" ? "Game finished." : "Waiting for Host to select a question."}
        </p>
      )}
    </div>
  );
}
