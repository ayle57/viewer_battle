import { z } from "zod";
import { participantRoleSchema } from "@/domain/session";
import type { ParticipantRole, TeamRole } from "@/domain/session";
import type { GameError, GameStatus, KernelErrorCode } from "../kernel";
import type { GameFinishedEvent, ScoreChangedEvent, Scoreboard } from "..";

/**
 * Gameplay decisions locked for this vertical slice — see AGENTS.md
 * "Game Kernel contract" for the full reasoning on each:
 *
 *   - The HOST selects every question from the board; teams don't pick.
 *   - The buzzed team submits its answer as text (SUBMIT_ANSWER) — this
 *     used to be "no free-text submission, teams play out loud, BUZZ IS
 *     the answer"; revised because the Dev Playground needs to exercise
 *     the full protocol end-to-end, not stand in for a verbal answer a
 *     script can't send. BUZZ still gates WHO may answer; SUBMIT_ANSWER
 *     is what they answer with. The submitted text is visible to every
 *     role (host, both teams, display) once sent — same as speaking it on
 *     a live stream, nothing to hide there. Only the reference `answer`
 *     stays host-only; that redaction is untouched.
 *   - JUDGE_ANSWER requires a submitted answer to exist — the host judges
 *     what was actually sent, not a verbal claim the app has no record
 *     of. Judging without a submission is WRONG_PHASE-shaped
 *     (ANSWER_NOT_SUBMITTED).
 *   - BUZZ opens the floor to a race between the two teams; whichever
 *     team's BUZZ the engine receives is the one that gets to submit
 *     next. After an incorrect judgment, the OTHER team may still buzz
 *     (a steal) — a team can't buzz twice on the same question.
 *   - Correct answers award the question's point value. Incorrect
 *     answers award nothing (no negative scoring) — the classic
 *     Jeopardy penalty is a real rule choice, not assumed here; revisit
 *     explicitly if the product wants it.
 *   - The board ends the game when every question has been played.
 *     Winner = highest score; equal scores end in "TIE".
 *   - END_GAME lets the HOST end the game early, from any phase — the
 *     same winner rule applies (highest current score; "TIE" if equal).
 *     The in-progress question, if any, is simply abandoned: no
 *     `history`/`playedQuestionIds` entry gets written for it, same as
 *     it never happened.
 */

export const boardQuestionSchema = z.object({
  id: z.string().min(1),
  categoryId: z.string().min(1),
  points: z.number().int().positive(),
  prompt: z.string().min(1),
  /** Reference answer, for the host's eyes while judging — never sent to players/display. Stripping it for those views is the server/UI's job, not this type's. */
  answer: z.string().min(1),
});
export type BoardQuestion = z.infer<typeof boardQuestionSchema>;

export const boardCategorySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});
export type BoardCategory = z.infer<typeof boardCategorySchema>;

export const boardQuestionConfigSchema = z.object({
  categories: z.array(boardCategorySchema).min(1),
  questions: z.array(boardQuestionSchema).min(1),
});
export type BoardQuestionConfig = z.infer<typeof boardQuestionConfigSchema>;

export type BoardQuestionPhase = "selecting" | "revealed" | "answering";

export interface PlayedQuestion {
  questionId: string;
  wonBy: TeamRole | null; // null if closed with no correct answer
}

export interface BoardQuestionState {
  status: GameStatus;
  phase: BoardQuestionPhase;
  categories: BoardCategory[];
  /** `answer` stays in state (the host needs it) — see boardQuestionSchema's note on stripping it for non-host views at the server/UI layer. */
  questions: BoardQuestion[];
  playedQuestionIds: string[];
  activeQuestionId: string | null;
  buzzedTeam: TeamRole | null;
  /** What `buzzedTeam` sent via SUBMIT_ANSWER for the current buzz, if anything yet — null once every time the floor reopens (a new question, a steal). Visible to every role; see the note above on why this isn't redacted like `answer` is. */
  submittedAnswer: string | null;
  attemptedTeams: TeamRole[];
  scores: Scoreboard;
  winner: TeamRole | "TIE" | null;
  history: PlayedQuestion[];
}

// `by` is the full participantRoleSchema on every action here, not a
// literal restricted to the "right" role(s) — role authorization is
// checked explicitly in engine.ts (-> FORBIDDEN_ROLE) instead of via the
// schema, so a wrong-role attempt is a distinct, specific, testable error
// rather than folded into generic shape-validation failures.

export const selectQuestionActionSchema = z.object({
  type: z.literal("SELECT_QUESTION"),
  by: participantRoleSchema,
  questionId: z.string().min(1),
});

export const buzzActionSchema = z.object({
  type: z.literal("BUZZ"),
  by: participantRoleSchema,
});

export const submitAnswerActionSchema = z.object({
  type: z.literal("SUBMIT_ANSWER"),
  by: participantRoleSchema,
  text: z.string().trim().min(1),
});

export const judgeAnswerActionSchema = z.object({
  type: z.literal("JUDGE_ANSWER"),
  by: participantRoleSchema,
  correct: z.boolean(),
});

export const closeQuestionActionSchema = z.object({
  type: z.literal("CLOSE_QUESTION"),
  by: participantRoleSchema,
});

/** Host-only, any phase: ends the game right now instead of waiting for the board to run out — see engine.ts's `applyEndGame`. */
export const endGameActionSchema = z.object({
  type: z.literal("END_GAME"),
  by: participantRoleSchema,
});

export const boardQuestionActionSchema = z.discriminatedUnion("type", [
  selectQuestionActionSchema,
  buzzActionSchema,
  submitAnswerActionSchema,
  judgeAnswerActionSchema,
  closeQuestionActionSchema,
  endGameActionSchema,
]);
export type BoardQuestionAction = z.infer<typeof boardQuestionActionSchema>;

export interface QuestionSelectedEvent {
  type: "QUESTION_SELECTED";
  questionId: string;
  categoryId: string;
  points: number;
}
export interface TeamBuzzedEvent {
  type: "TEAM_BUZZED";
  team: TeamRole;
}
export interface AnswerSubmittedEvent {
  type: "ANSWER_SUBMITTED";
  team: TeamRole;
  text: string;
}
export interface AnswerJudgedEvent {
  type: "ANSWER_JUDGED";
  team: TeamRole;
  correct: boolean;
  pointsAwarded: number;
}
export interface QuestionClosedEvent {
  type: "QUESTION_CLOSED";
  questionId: string;
  wonBy: TeamRole | null;
}

export type BoardQuestionEvent =
  | QuestionSelectedEvent
  | TeamBuzzedEvent
  | AnswerSubmittedEvent
  | AnswerJudgedEvent
  | QuestionClosedEvent
  | ScoreChangedEvent
  | GameFinishedEvent;

export type BoardQuestionErrorCode =
  | KernelErrorCode
  | "QUESTION_NOT_FOUND"
  | "QUESTION_ALREADY_PLAYED"
  | "TEAM_ALREADY_ATTEMPTED"
  | "ANSWER_ALREADY_SUBMITTED"
  | "ANSWER_NOT_SUBMITTED";

export type BoardQuestionError = GameError<BoardQuestionErrorCode>;

/** Which roles may act at all — DISPLAY never can, everywhere in this app. */
export function isPlayableRole(role: ParticipantRole): role is "HOST" | TeamRole {
  return role === "HOST" || role === "TEAM_A" || role === "TEAM_B";
}
