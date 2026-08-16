import { isTeamRole, TEAM_ROLES, type ParticipantRole, type TeamRole } from "@/domain/session";
import { err, ok, type EngineResult, type GameEngine } from "../kernel";
import { addScore, leadingTeam, type Scoreboard } from "../scoring";
import { gameFinishedEvent, scoreChangedEvent } from "../events";
import {
  boardQuestionActionSchema,
  boardQuestionConfigSchema,
  type BoardQuestionAction,
  type BoardQuestionConfig,
  type BoardQuestionEvent,
  type BoardQuestionState,
} from "./types";
import { toPublicView } from "./view";

export function createInitialState(config: BoardQuestionConfig): BoardQuestionState {
  const parsed = boardQuestionConfigSchema.parse(config);
  return {
    status: "in_progress",
    phase: "selecting",
    categories: parsed.categories,
    questions: parsed.questions,
    playedQuestionIds: [],
    activeQuestionId: null,
    buzzedTeam: null,
    submittedAnswer: null,
    attemptedTeams: [],
    scores: { TEAM_A: 0, TEAM_B: 0 },
    winner: null,
    history: [],
  };
}

export function apply(
  state: BoardQuestionState,
  action: BoardQuestionAction,
): EngineResult<BoardQuestionState, BoardQuestionEvent> {
  // Re-validated regardless of the static type: `action` is what a socket
  // or tRPC handler decoded from untrusted JSON, cast to this type by a
  // caller that hasn't actually checked it. See kernel.ts.
  const parsed = boardQuestionActionSchema.safeParse(action);
  if (!parsed.success) {
    return err("INVALID_ACTION", parsed.error.issues[0]?.message ?? "Invalid action");
  }
  const validated = parsed.data;

  if (state.status === "finished") {
    return err("GAME_ALREADY_FINISHED", "This game has already finished.");
  }

  switch (validated.type) {
    case "SELECT_QUESTION":
      return applySelectQuestion(state, validated.by, validated.questionId);
    case "BUZZ":
      return applyBuzz(state, validated.by);
    case "SUBMIT_ANSWER":
      return applySubmitAnswer(state, validated.by, validated.text);
    case "JUDGE_ANSWER":
      return applyJudgeAnswer(state, validated.by, validated.correct);
    case "CLOSE_QUESTION":
      return applyCloseQuestion(state, validated.by);
    case "END_GAME":
      return applyEndGame(state, validated.by);
  }
}

function applySelectQuestion(
  state: BoardQuestionState,
  by: ParticipantRole,
  questionId: string,
): EngineResult<BoardQuestionState, BoardQuestionEvent> {
  if (by !== "HOST") return err("FORBIDDEN_ROLE", "Only the host selects a question.");
  if (state.phase !== "selecting") {
    return err("WRONG_PHASE", `Cannot select a question during phase "${state.phase}".`);
  }
  const question = state.questions.find((q) => q.id === questionId);
  if (!question) return err("QUESTION_NOT_FOUND", `No question with id "${questionId}".`);
  if (state.playedQuestionIds.includes(question.id)) {
    return err("QUESTION_ALREADY_PLAYED", `Question "${question.id}" has already been played.`);
  }

  const nextState: BoardQuestionState = {
    ...state,
    phase: "revealed",
    activeQuestionId: question.id,
    buzzedTeam: null,
    submittedAnswer: null,
    attemptedTeams: [],
  };
  return ok(nextState, [
    { type: "QUESTION_SELECTED", questionId: question.id, categoryId: question.categoryId, points: question.points },
  ]);
}

function applyBuzz(state: BoardQuestionState, by: ParticipantRole): EngineResult<BoardQuestionState, BoardQuestionEvent> {
  if (!isTeamRole(by)) return err("FORBIDDEN_ROLE", "Only a team may buzz in.");
  if (state.phase !== "revealed") {
    return err("WRONG_PHASE", `Cannot buzz during phase "${state.phase}".`);
  }
  if (state.attemptedTeams.includes(by)) {
    return err("TEAM_ALREADY_ATTEMPTED", `${by} has already attempted this question.`);
  }

  const nextState: BoardQuestionState = { ...state, phase: "answering", buzzedTeam: by, submittedAnswer: null };
  return ok(nextState, [{ type: "TEAM_BUZZED", team: by }]);
}

function applySubmitAnswer(
  state: BoardQuestionState,
  by: ParticipantRole,
  text: string,
): EngineResult<BoardQuestionState, BoardQuestionEvent> {
  if (!isTeamRole(by)) return err("FORBIDDEN_ROLE", "Only a team may submit an answer.");
  if (state.phase !== "answering" || !state.buzzedTeam) {
    return err("WRONG_PHASE", `Cannot submit an answer during phase "${state.phase}".`);
  }
  if (by !== state.buzzedTeam) {
    return err("FORBIDDEN_ROLE", "Only the team that buzzed may submit an answer.");
  }
  if (state.submittedAnswer !== null) {
    return err("ANSWER_ALREADY_SUBMITTED", `${by} already submitted an answer for this buzz.`);
  }

  const nextState: BoardQuestionState = { ...state, submittedAnswer: text };
  return ok(nextState, [{ type: "ANSWER_SUBMITTED", team: by, text }]);
}

function applyJudgeAnswer(
  state: BoardQuestionState,
  by: ParticipantRole,
  correct: boolean,
): EngineResult<BoardQuestionState, BoardQuestionEvent> {
  if (by !== "HOST") return err("FORBIDDEN_ROLE", "Only the host judges an answer.");
  if (state.phase !== "answering" || !state.buzzedTeam || !state.activeQuestionId) {
    return err("WRONG_PHASE", `Cannot judge an answer during phase "${state.phase}".`);
  }
  if (state.submittedAnswer === null) {
    return err("ANSWER_NOT_SUBMITTED", "Wait for the team's answer before judging.");
  }
  const team = state.buzzedTeam;
  const question = state.questions.find((q) => q.id === state.activeQuestionId);
  if (!question) return err("QUESTION_NOT_FOUND", "The active question no longer exists.");

  const events: BoardQuestionEvent[] = [];

  if (correct) {
    const scores = addScore(state.scores, team, question.points);
    events.push({ type: "ANSWER_JUDGED", team, correct: true, pointsAwarded: question.points });
    events.push(scoreChangedEvent(team, question.points, scores));
    return finishIfBoardComplete(closeQuestion(state, question.id, team, scores), events);
  }

  events.push({ type: "ANSWER_JUDGED", team, correct: false, pointsAwarded: 0 });
  const attemptedTeams = [...state.attemptedTeams, team];
  const anyTeamLeftToTry = TEAM_ROLES.some((t) => !attemptedTeams.includes(t));

  if (anyTeamLeftToTry) {
    // A steal is still possible — reopen the floor, don't close the question.
    return ok({ ...state, phase: "revealed", buzzedTeam: null, submittedAnswer: null, attemptedTeams }, events);
  }

  // Both teams tried and neither got it — the question closes with no winner.
  events.push({ type: "QUESTION_CLOSED", questionId: question.id, wonBy: null });
  return finishIfBoardComplete(closeQuestion({ ...state, attemptedTeams }, question.id, null, state.scores), events);
}

function applyCloseQuestion(
  state: BoardQuestionState,
  by: ParticipantRole,
): EngineResult<BoardQuestionState, BoardQuestionEvent> {
  if (by !== "HOST") return err("FORBIDDEN_ROLE", "Only the host closes a question.");
  if (state.phase === "selecting" || !state.activeQuestionId) {
    return err("WRONG_PHASE", `Cannot close a question during phase "${state.phase}".`);
  }

  const questionId = state.activeQuestionId;
  const events: BoardQuestionEvent[] = [{ type: "QUESTION_CLOSED", questionId, wonBy: null }];
  return finishIfBoardComplete(closeQuestion(state, questionId, null, state.scores), events);
}

/** Marks a question played and returns the board to "selecting" — shared tail of every path that ends a question (correct answer, both teams failed, or a manual close). */
function closeQuestion(
  state: BoardQuestionState,
  questionId: string,
  wonBy: TeamRole | null,
  scores: Scoreboard,
): BoardQuestionState {
  return {
    ...state,
    phase: "selecting",
    activeQuestionId: null,
    buzzedTeam: null,
    submittedAnswer: null,
    attemptedTeams: [],
    playedQuestionIds: [...state.playedQuestionIds, questionId],
    history: [...state.history, { questionId, wonBy }],
    scores,
  };
}

/**
 * The host stopping a game early — from any phase, whether or not a
 * question is mid-play. Same winner rule as running out the board
 * (`finishIfBoardComplete`): highest current score, "TIE" if equal.
 * Whatever question was active is simply abandoned — no `history`/
 * `playedQuestionIds` entry, as if it never happened — rather than
 * forced through `closeQuestion`'s bookkeeping for a question nobody
 * actually finished playing.
 */
function applyEndGame(state: BoardQuestionState, by: ParticipantRole): EngineResult<BoardQuestionState, BoardQuestionEvent> {
  if (by !== "HOST") return err("FORBIDDEN_ROLE", "Only the host can end the game.");

  const winner = leadingTeam(state.scores) ?? "TIE";
  const nextState: BoardQuestionState = {
    ...state,
    status: "finished",
    phase: "selecting",
    activeQuestionId: null,
    buzzedTeam: null,
    submittedAnswer: null,
    attemptedTeams: [],
    winner,
  };
  return ok(nextState, [gameFinishedEvent(winner, state.scores)]);
}

/** Every question played -> game over. Called after every closeQuestion. */
function finishIfBoardComplete(
  state: BoardQuestionState,
  events: BoardQuestionEvent[],
): EngineResult<BoardQuestionState, BoardQuestionEvent> {
  if (state.playedQuestionIds.length < state.questions.length) {
    return ok(state, events);
  }
  const winner = leadingTeam(state.scores) ?? "TIE";
  return ok({ ...state, status: "finished", winner }, [...events, gameFinishedEvent(winner, state.scores)]);
}

export function availableActions(state: BoardQuestionState, role: ParticipantRole): string[] {
  if (state.status === "finished") return [];
  // The host can end the game from any phase — appended, not a
  // replacement for whatever else the phase already permits.
  const hostCanAlwaysEnd = role === "HOST" ? ["END_GAME"] : [];
  switch (state.phase) {
    case "selecting":
      return role === "HOST" ? ["SELECT_QUESTION", ...hostCanAlwaysEnd] : [];
    case "revealed":
      if (isTeamRole(role) && !state.attemptedTeams.includes(role)) return ["BUZZ"];
      return role === "HOST" ? ["CLOSE_QUESTION", ...hostCanAlwaysEnd] : [];
    case "answering":
      if (role === "HOST") {
        return [...(state.submittedAnswer === null ? ["CLOSE_QUESTION"] : ["JUDGE_ANSWER", "CLOSE_QUESTION"]), ...hostCanAlwaysEnd];
      }
      if (isTeamRole(role) && role === state.buzzedTeam && state.submittedAnswer === null) return ["SUBMIT_ANSWER"];
      return [];
  }
}

export const boardQuestionEngine: GameEngine<BoardQuestionState, BoardQuestionAction, BoardQuestionEvent, BoardQuestionConfig> =
  {
    id: "board-question",
    label: "Mini Jeopardy",
    description: "Host-picked categories and questions — buzz in, answer, and steal points.",
    meta: "2 teams · live quiz",
    hasContentStudio: true,
    createInitialState,
    apply,
    availableActions,
    toPublicView,
    getWinner: (state) => (state.status === "finished" ? state.winner : null),
  };
