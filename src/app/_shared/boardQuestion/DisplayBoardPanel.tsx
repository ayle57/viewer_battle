"use client";

import type { BoardQuestionState } from "@/domain/game/boardQuestion";
import { Card, CardBody, QuestionPrompt, ScoreDisplay } from "@/ui";
import { BoardGrid } from "./BoardGrid";
import { describeLastResult, lastJudgment } from "./events";
import styles from "./DisplayBoardPanel.module.css";

export interface DisplayBoardPanelProps {
  state: BoardQuestionState;
  lastEvents: unknown[];
}

const TEAM_LABEL: Record<"TEAM_A" | "TEAM_B", string> = { TEAM_A: "TEAM A", TEAM_B: "TEAM B" };

/**
 * Read-only, built for OBS capture, not for operating anything — no
 * `sendAction` prop even exists here, so there is no path from this
 * component to a `game:action` no matter what future edits do to it.
 * Bigger type, more whitespace, no controls, no secrets: `answer` is
 * still empty here (redacted server-side for every non-host role), but
 * `submittedAnswer` is real and shown — a team's answer is public the
 * moment they send it, same as saying it out loud on stream.
 */
export function DisplayBoardPanel({ state, lastEvents }: DisplayBoardPanelProps) {
  const activeQuestion = state.questions.find((q) => q.id === state.activeQuestionId) ?? null;
  const category = activeQuestion ? state.categories.find((c) => c.id === activeQuestion.categoryId) : undefined;
  const judgment = state.buzzedTeam === null ? lastJudgment(lastEvents) : null;
  const lastResult = !judgment ? describeLastResult(lastEvents) : null;
  const teamClass = state.buzzedTeam === "TEAM_A" ? styles.buzzedTeamA : styles.buzzedTeamB;

  return (
    <div className={styles.wrap}>
      <Card variant="raised" className={styles.scoreCard}>
        <CardBody>
          <ScoreDisplay teamAName="Team A" teamAScore={state.scores.TEAM_A} teamBName="Team B" teamBScore={state.scores.TEAM_B} size="lg" />
        </CardBody>
      </Card>

      {state.status === "finished" && (
        <p className={styles.finishedBanner}>{state.winner === "TIE" ? "It's a tie!" : `${state.winner} wins!`}</p>
      )}

      <Card>
        <CardBody>
          <BoardGrid state={state} size="lg" />
        </CardBody>
      </Card>

      {activeQuestion && (
        <Card variant="raised">
          <CardBody>
            <QuestionPrompt category={category?.name} points={activeQuestion.points} prompt={activeQuestion.prompt} size="lg" />
          </CardBody>
        </Card>
      )}

      {state.buzzedTeam && (
        <div className={styles.buzzedBlock}>
          <p className={[styles.buzzedBanner, teamClass].join(" ")}>{TEAM_LABEL[state.buzzedTeam]} IS ANSWERING</p>
          {state.submittedAnswer !== null && <p className={styles.submittedAnswer}>&ldquo;{state.submittedAnswer}&rdquo;</p>}
        </div>
      )}

      {!state.buzzedTeam && judgment && (
        <p className={[styles.judgmentBanner, judgment.correct ? styles.correct : styles.incorrect].join(" ")}>
          {judgment.correct ? "CORRECT" : "INCORRECT"}
        </p>
      )}
      {!state.buzzedTeam && !judgment && lastResult && <p className={styles.resultBanner}>{lastResult}</p>}

      {!activeQuestion && state.status === "in_progress" && (
        <p className={styles.statusLine}>Waiting for the next question…</p>
      )}
    </div>
  );
}
