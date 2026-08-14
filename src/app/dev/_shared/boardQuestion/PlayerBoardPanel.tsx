"use client";

import { useState } from "react";
import type { BoardQuestionState } from "@/domain/game/boardQuestion";
import { AnswerInput, BuzzButton, Card, CardBody, QuestionPrompt, ScoreDisplay } from "@/ui";
import { BoardGrid } from "./BoardGrid";
import { describeLastResult } from "./events";
import { readableGameError } from "./gameErrorMessages";
import styles from "./PlayerBoardPanel.module.css";

export interface PlayerBoardPanelProps {
  state: BoardQuestionState;
  role: "TEAM_A" | "TEAM_B";
  lastEvents: unknown[];
  sendAction: (action: Record<string, unknown>) => Promise<{ ok: boolean; error?: { code: string; message: string } }>;
}

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
  const lastResult = describeLastResult(lastEvents);
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
      {!error && lastResult && <p className={styles.resultBanner}>{lastResult}</p>}

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
              {itsMyTurn && (
                <>
                  <p className={[styles.statusLine, styles.myTurn].join(" ")}>It&apos;s your turn — answer!</p>
                  <AnswerInput onSubmit={(text) => void submitAnswer(text)} pending={answering} submitted={iSubmitted} />
                </>
              )}

              {state.buzzedTeam && !itsMyTurn && (
                <div className={styles.otherTeamAnswering}>
                  <p className={styles.statusLine}>{state.buzzedTeam} is answering…</p>
                  {state.submittedAnswer !== null && (
                    <p className={styles.theirAnswer}>
                      &ldquo;{state.submittedAnswer}&rdquo; — waiting on the host&apos;s call
                    </p>
                  )}
                </div>
              )}

              {!state.buzzedTeam && canBuzz && (
                <>
                  {isSteal && <p className={styles.statusLine}>{role} can steal this one!</p>}
                  <BuzzButton variant={variant} pending={buzzing} onClick={() => void buzz()} />
                </>
              )}

              {!state.buzzedTeam && !canBuzz && myTeamAlreadyOut && !otherTeamAlreadyOut && (
                <p className={styles.statusLine}>Your team already tried — {otherTeam} can steal now.</p>
              )}
              {!state.buzzedTeam && !canBuzz && myTeamAlreadyOut && otherTeamAlreadyOut && (
                <p className={styles.statusLine}>Both teams have tried this question.</p>
              )}
            </div>
          </CardBody>
        </Card>
      ) : (
        <p className={styles.statusLine}>
          {state.status === "finished" ? "Game finished." : "Waiting for the host to select a question."}
        </p>
      )}
    </div>
  );
}
