"use client";

import { useState } from "react";
import type { BoardQuestionState } from "@/domain/game/boardQuestion";
import { AnswerInput, BuzzButton, QuestionPrompt } from "@/ui";
import { AnimatedScoreDisplay } from "./AnimatedScoreDisplay";
import { BuzzImpact } from "./BuzzImpact";
import { BoardGrid } from "./BoardGrid";
import { describeLastResult, lastJudgment } from "./events";
import { readableGameError } from "./gameErrorMessages";
import { CountdownBadge } from "@/app/_shared/CountdownBadge";
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
 *
 * Aligned with PlayerGeoPanel's own visual family (same UX/UI pass —
 * see todos.md): no more nested Cards stacking the score, the board,
 * and the question on top of each other — a compact score line, the
 * board itself as the one persistent reference, and the active
 * question/buzz/answer moment as the actual hero of the screen. Same
 * mechanics throughout, nothing about BUZZ/SUBMIT_ANSWER/judging
 * changed, only how it's laid out.
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
      <div className={styles.scoreLine}>
        <AnimatedScoreDisplay teamAName="Team A" teamAScore={state.scores.TEAM_A} teamBName="Team B" teamBScore={state.scores.TEAM_B} />
      </div>

      {/* Read-only — same shared badge GeoGuessr's own PlayerGeoPanel
          uses (src/domain/game/countdown.ts's own doc comment), no
          `sendAction` anywhere near it. */}
      <CountdownBadge deadlineMs={state.countdownDeadline} label="Game ends in" />

      {error && <p className={styles.errorBanner}>{readableGameError(error.code, error.message)}</p>}
      {!error && judgment && (
        <p className={[styles.judgmentBanner, judgment.correct ? styles.correct : styles.incorrect].join(" ")} role="status" aria-live="polite">
          {judgment.correct ? "CORRECT" : "INCORRECT"}
        </p>
      )}
      {!error && !judgment && otherResult && (
        <p className={styles.resultBanner} role="status" aria-live="polite">
          {otherResult}
        </p>
      )}

      <BoardGrid state={state} />

      {activeQuestion ? (
        <div className={styles.questionArea}>
          <QuestionPrompt category={category?.name} points={activeQuestion.points} prompt={activeQuestion.prompt} />
          <div className={styles.buzzArea}>
            {itsMyTurn && (
              <BuzzImpact team={role}>
                <>
                  {!iSubmitted && (
                    <>
                      <p className={[styles.statusLine, styles.myTurn].join(" ")}>YOU BUZZED</p>
                      <p className={styles.answerLabel}>Your answer</p>
                    </>
                  )}
                  <AnswerInput onSubmit={(text) => void submitAnswer(text)} pending={answering} submitted={iSubmitted} submitLabel="SEND ANSWER" />
                  {iSubmitted && <p className={styles.statusLine}>ANSWER SENT</p>}
                </>
              </BuzzImpact>
            )}

            {state.buzzedTeam && !itsMyTurn && (
              <BuzzImpact team={state.buzzedTeam}>
                <div className={styles.otherTeamAnswering}>
                  <p className={styles.statusLine}>{TEAM_LABEL[state.buzzedTeam]} IS ANSWERING</p>
                  {state.submittedAnswer !== null && <p className={styles.theirAnswer}>&ldquo;{state.submittedAnswer}&rdquo;</p>}
                </div>
              </BuzzImpact>
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
            {!state.buzzedTeam && !canBuzz && myTeamAlreadyOut && otherTeamAlreadyOut && <p className={styles.statusLine}>Both teams have tried this question.</p>}
          </div>
        </div>
      ) : (
        <p className={styles.statusLine}>{state.status === "finished" ? "Game finished." : "Waiting for Host to select a question."}</p>
      )}
    </div>
  );
}
