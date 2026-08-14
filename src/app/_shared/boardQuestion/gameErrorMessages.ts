/**
 * Business error codes -> readable text. Pure presentation/translation —
 * the actual rule that produced the code is enforced server-side (see
 * src/domain/game/boardQuestion and src/server/game); this file doesn't
 * decide anything, it just describes what already happened. Shared by
 * host/player/display so the same code reads the same way everywhere.
 */
const GAME_ERROR_MESSAGES: Record<string, string> = {
  INVALID_ACTION: "That action wasn't valid — try again.",
  UNKNOWN_ACTION: "That action isn't supported.",
  WRONG_PHASE: "You can't do that right now.",
  FORBIDDEN_ROLE: "You're not allowed to do that.",
  GAME_ALREADY_FINISHED: "This game has already finished.",
  QUESTION_NOT_FOUND: "That question doesn't exist.",
  QUESTION_ALREADY_PLAYED: "That question has already been played.",
  TEAM_ALREADY_ATTEMPTED: "Your team already tried this question.",
  ANSWER_ALREADY_SUBMITTED: "Your team already submitted an answer for this buzz.",
  ANSWER_NOT_SUBMITTED: "Waiting for the team's answer before you can judge it.",
  GAME_NOT_FOUND: "No game is running yet.",
  GAME_IN_PROGRESS: "A game is already in progress.",
  UNKNOWN_GAME: "Unknown game type.",
  CONFLICT: "Someone else acted at the same moment — try again.",
  INTERNAL_ERROR: "Something went wrong on our end.",
};

export function readableGameError(code: string, fallbackMessage: string): string {
  return GAME_ERROR_MESSAGES[code] ?? fallbackMessage;
}
