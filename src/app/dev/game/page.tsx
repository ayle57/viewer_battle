"use client";

import { useState } from "react";
import {
  boardQuestionEngine,
  sampleBoard,
  type BoardQuestionAction,
  type BoardQuestionEvent,
  type BoardQuestionState,
} from "@/domain/game/boardQuestion";
import type { ParticipantRole } from "@/domain/session";
import { Badge, Button, Card, CardBody, CardHeader, Input } from "@/ui";
import styles from "./page.module.css";

/**
 * Registry of engines this lab can drive — real, not decorative, even
 * with one entry today. Adding an engine later means adding a key here,
 * nothing about this page's plumbing changes.
 */
const ENGINES = {
  "board-question": boardQuestionEngine,
} as const;
type EngineId = keyof typeof ENGINES;

const ROLE_LABEL: Record<ParticipantRole, string> = {
  HOST: "Host",
  TEAM_A: "Team A",
  TEAM_B: "Team B",
  DISPLAY: "Display",
};

type LogResult =
  | { ok: true; events: BoardQuestionEvent[] }
  | { ok: false; error: { code: string; message: string } };

interface LogEntry {
  id: number;
  action: BoardQuestionAction;
  result: LogResult;
}

export default function GamePage() {
  const [engineId] = useState<EngineId>("board-question");
  const engine = ENGINES[engineId];

  const [state, setState] = useState<BoardQuestionState>(() => engine.createInitialState(sampleBoard));
  const [role, setRole] = useState<ParticipantRole>("HOST");
  const [log, setLog] = useState<LogEntry[]>([]);
  const [answerDraft, setAnswerDraft] = useState("");

  const availableActionTypes = engine.availableActions(state, role);

  function dispatch(action: BoardQuestionAction) {
    const result = engine.apply(state, action);
    const entry: LogEntry = result.ok
      ? { id: log.length + 1, action, result: { ok: true, events: result.events } }
      : { id: log.length + 1, action, result: { ok: false, error: result.error } };
    setLog((current) => [...current, entry]);
    if (result.ok) setState(result.state);
  }

  function reset() {
    setState(engine.createInitialState(sampleBoard));
    setLog([]);
    setAnswerDraft("");
  }

  const questionsByCategory = new Map<string, typeof state.questions>();
  for (const category of state.categories) questionsByCategory.set(category.id, []);
  for (const question of state.questions) questionsByCategory.get(question.categoryId)?.push(question);

  const activeQuestion = state.questions.find((q) => q.id === state.activeQuestionId) ?? null;
  const lastEntry = log[log.length - 1];
  const lastError = lastEntry && !lastEntry.result.ok ? lastEntry.result.error : null;

  return (
    <main className={styles.page}>
      <h1>Game</h1>
      <p className={styles.hint}>
        Real Game Kernel cockpit — every action here goes through the actual{" "}
        <code>src/domain/game/boardQuestion</code> engine, in the browser, no server round-trip. Board content is
        fixture data (<code>sampleBoard</code>), explicitly not real show content.
      </p>

      <div className={styles.controlsRow}>
        <div className={styles.selectField}>
          <label className={styles.selectLabel} htmlFor="engine">
            Engine
          </label>
          <select id="engine" className={styles.select} value={engineId} disabled>
            <option value="board-question">{engine.label}</option>
          </select>
        </div>
        <div className={styles.selectField}>
          <label className={styles.selectLabel} htmlFor="role">
            Acting as
          </label>
          <select
            id="role"
            className={styles.select}
            value={role}
            onChange={(event) => setRole(event.target.value as ParticipantRole)}
          >
            {(Object.keys(ROLE_LABEL) as ParticipantRole[]).map((value) => (
              <option key={value} value={value}>
                {ROLE_LABEL[value]}
              </option>
            ))}
          </select>
        </div>
        <Button variant="ghost" size="sm" onClick={reset}>
          Reset game
        </Button>
      </div>

      <div className={styles.statusRow}>
        <Badge variant={state.status === "finished" ? "success" : "neutral"}>{state.status}</Badge>
        <Badge variant="neutral">phase: {state.phase}</Badge>
        <Badge variant="teamA">Team A: {state.scores.TEAM_A}</Badge>
        <Badge variant="teamB">Team B: {state.scores.TEAM_B}</Badge>
        {state.winner && <Badge variant="host">winner: {state.winner}</Badge>}
        <Badge variant="neutral">
          available: {availableActionTypes.length ? availableActionTypes.join(", ") : "none"}
        </Badge>
      </div>

      {lastError && (
        <p className={styles.errorBanner}>
          {lastError.code} — {lastError.message}
        </p>
      )}

      <div className={styles.layout}>
        <Card>
          <CardHeader title="Board" subtitle="Click a question as Host, in the selecting phase" />
          <CardBody>
            <div className={styles.board} style={{ gridTemplateColumns: `repeat(${state.categories.length}, 1fr)` }}>
              {state.categories.map((category) => (
                <div key={category.id} className={styles.categoryColumn}>
                  <p className={styles.categoryHeader}>{category.name}</p>
                  {(questionsByCategory.get(category.id) ?? []).map((question) => {
                    const played = state.playedQuestionIds.includes(question.id);
                    const selectable =
                      !played && availableActionTypes.includes("SELECT_QUESTION") && role === "HOST";
                    const isActive = question.id === state.activeQuestionId;
                    return (
                      <button
                        key={question.id}
                        type="button"
                        disabled={!selectable}
                        className={[
                          styles.cell,
                          selectable && styles.cellSelectable,
                          played && styles.cellPlayed,
                          isActive && styles.cellActive,
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        onClick={() => dispatch({ type: "SELECT_QUESTION", by: role, questionId: question.id })}
                      >
                        {played ? "played" : question.points}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>

            {activeQuestion && (
              <div className={styles.activeQuestion} style={{ marginTop: "1.5rem" }}>
                <p className={styles.prompt}>{activeQuestion.prompt}</p>
                <p className={styles.answer}>Answer (host only): {activeQuestion.answer}</p>
                <div className={styles.statusRow}>
                  <Badge variant="neutral">buzzed: {state.buzzedTeam ?? "none"}</Badge>
                  <Badge variant="neutral">
                    attempted: {state.attemptedTeams.length ? state.attemptedTeams.join(", ") : "none"}
                  </Badge>
                </div>
                <div className={styles.actionsRow}>
                  {availableActionTypes.includes("BUZZ") && (
                    <Button size="sm" onClick={() => dispatch({ type: "BUZZ", by: role })}>
                      Buzz in as {ROLE_LABEL[role]}
                    </Button>
                  )}
                  {availableActionTypes.includes("SUBMIT_ANSWER") && (
                    <div className={styles.answerRow}>
                      <Input
                        size="sm"
                        value={answerDraft}
                        onChange={(event) => setAnswerDraft(event.target.value)}
                        placeholder="Answer text..."
                        aria-label="Answer text"
                      />
                      <Button
                        size="sm"
                        disabled={answerDraft.trim().length === 0}
                        onClick={() => {
                          dispatch({ type: "SUBMIT_ANSWER", by: role, text: answerDraft.trim() });
                          setAnswerDraft("");
                        }}
                      >
                        Submit answer
                      </Button>
                    </div>
                  )}
                  {state.submittedAnswer !== null && (
                    <Badge variant="neutral">submitted: &ldquo;{state.submittedAnswer}&rdquo;</Badge>
                  )}
                  {availableActionTypes.includes("JUDGE_ANSWER") && (
                    <>
                      <Button size="sm" onClick={() => dispatch({ type: "JUDGE_ANSWER", by: role, correct: true })}>
                        Mark correct
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => dispatch({ type: "JUDGE_ANSWER", by: role, correct: false })}
                      >
                        Mark incorrect
                      </Button>
                    </>
                  )}
                  {availableActionTypes.includes("CLOSE_QUESTION") && (
                    <Button size="sm" variant="ghost" onClick={() => dispatch({ type: "CLOSE_QUESTION", by: role })}>
                      Close question
                    </Button>
                  )}
                </div>
              </div>
            )}

            {!activeQuestion && state.status === "in_progress" && (
              <p className={styles.empty} style={{ marginTop: "1rem" }}>
                No active question — {role === "HOST" ? "select one above." : "waiting for the host to select one."}
              </p>
            )}

            {state.status === "finished" && (
              <p className={styles.empty} style={{ marginTop: "1rem" }}>
                Game finished. Reset to play again.
              </p>
            )}
          </CardBody>
        </Card>

        <div className={styles.sidebar}>
          <Card>
            <CardHeader title="Event log" subtitle={`${log.length} action${log.length === 1 ? "" : "s"} applied`} />
            <CardBody>
              <div className={styles.eventLog}>
                {log.length === 0 && <p className={styles.empty}>No actions yet.</p>}
                {log.map((entry) => (
                  <div
                    key={entry.id}
                    className={[styles.eventGroup, !entry.result.ok && styles.eventGroupError]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <p className={styles.eventGroupAction}>
                      {entry.action.type} <span className={styles.eventLine}>by {entry.action.by}</span>
                    </p>
                    {entry.result.ok ? (
                      entry.result.events.length === 0 ? (
                        <p className={styles.eventLine}>(no events)</p>
                      ) : (
                        entry.result.events.map((event, i) => (
                          <p key={i} className={styles.eventLine}>
                            {event.type} {JSON.stringify(event).slice(0, 80)}
                          </p>
                        ))
                      )
                    ) : (
                      <p className={styles.eventLine}>
                        rejected: {entry.result.error.code} — {entry.result.error.message}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    </main>
  );
}
