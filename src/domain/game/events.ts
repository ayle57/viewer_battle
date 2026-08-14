import type { TeamRole } from "@/domain/session";
import type { Scoreboard } from "./scoring";

/**
 * Shared event shapes for the common cross-engine moments — a team's
 * score changed, the game ended. Engines emit these alongside their own
 * specific events (e.g. BoardQuestionEngine's QuestionSelected) in the
 * same `events` array; there's no requirement to use these, just no
 * reason to reinvent them per engine when the shape is genuinely the
 * same. No timestamps here on purpose — see kernel.ts's "no wall-clock
 * reads inside apply" rule; the server stamps events when it persists/
 * broadcasts them.
 */
export interface ScoreChangedEvent {
  type: "SCORE_CHANGED";
  team: TeamRole;
  delta: number;
  scores: Scoreboard;
}

export interface GameFinishedEvent {
  type: "GAME_FINISHED";
  winner: TeamRole | "TIE";
  scores: Scoreboard;
}

export function scoreChangedEvent(team: TeamRole, delta: number, scores: Scoreboard): ScoreChangedEvent {
  return { type: "SCORE_CHANGED", team, delta, scores };
}

export function gameFinishedEvent(winner: TeamRole | "TIE", scores: Scoreboard): GameFinishedEvent {
  return { type: "GAME_FINISHED", winner, scores };
}
