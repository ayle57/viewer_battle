/**
 * Business error codes -> readable text — the Music counterpart to
 * boardQuestion/gameErrorMessages.ts / geoGuessr/gameErrorMessages.ts.
 * Pure presentation/translation, same posture as those two: the actual
 * rule that produced the code is enforced server-side (src/domain/game/
 * music, src/server/game); this file doesn't decide anything. Shared by
 * host/player/display so the same code reads the same way everywhere.
 */
const GAME_ERROR_MESSAGES: Record<string, string> = {
  INVALID_ACTION: "That action wasn't valid — try again.",
  UNKNOWN_ACTION: "That action isn't supported.",
  WRONG_PHASE: "You can't do that right now.",
  FORBIDDEN_ROLE: "You're not allowed to do that.",
  GAME_ALREADY_FINISHED: "This game has already finished.",
  ROUND_NOT_FOUND: "That track doesn't exist.",
  PLAYBACK_NOT_STARTED: "Start the track's first playback before replaying or pausing it.",
  ALREADY_PAUSED: "Playback is already paused.",
  NOT_PAUSED: "Playback isn't paused.",
  TEAM_ALREADY_ATTEMPTED: "Your team already tried this track.",
  ANSWER_ALREADY_SUBMITTED: "Your team already submitted an answer for this buzz.",
  ANSWER_NOT_SUBMITTED: "Waiting for the team's answer before you can judge it.",
  NO_ROUNDS_REMAINING: "There are no more tracks to play.",
  GAME_NOT_FOUND: "No game is running yet.",
  GAME_IN_PROGRESS: "A game is already in progress.",
  UNKNOWN_GAME: "Unknown game type.",
  CONFLICT: "Someone else acted at the same moment — try again.",
  INTERNAL_ERROR: "Something went wrong on our end.",
};

export function readableMusicError(code: string, fallbackMessage: string): string {
  return GAME_ERROR_MESSAGES[code] ?? fallbackMessage;
}
