/**
 * Business error codes -> readable text — the Steam Ratings counterpart
 * to boardQuestion/gameErrorMessages.ts / geoGuessr/gameErrorMessages.ts
 * / music/gameErrorMessages.ts. Pure presentation/translation, same
 * posture as those: the actual rule that produced the code is enforced
 * server-side (src/domain/game/steamRatings, src/server/game); this file
 * doesn't decide anything. Shared by host/player/display so the same
 * code reads the same way everywhere.
 */
const GAME_ERROR_MESSAGES: Record<string, string> = {
  INVALID_ACTION: "That action wasn't valid — try again.",
  UNKNOWN_ACTION: "That action isn't supported.",
  WRONG_PHASE: "You can't do that right now.",
  FORBIDDEN_ROLE: "You're not allowed to do that.",
  GAME_ALREADY_FINISHED: "This game has already finished.",
  ROUND_NOT_FOUND: "That game doesn't exist.",
  NO_RATINGS_REMAINING: "Every rating for this round has already been revealed.",
  NOTHING_REVEALED_YET: "Wait for the Host to reveal at least one rating first.",
  TEAM_ALREADY_ATTEMPTED: "Your team already tried this round.",
  NO_ROUNDS_REMAINING: "There are no more games to play.",
  GAME_NOT_FOUND: "No game is running yet.",
  GAME_IN_PROGRESS: "A game is already in progress.",
  UNKNOWN_GAME: "Unknown game type.",
  CONFLICT: "Someone else acted at the same moment — try again.",
  INTERNAL_ERROR: "Something went wrong on our end.",
};

export function readableSteamRatingsError(code: string, fallbackMessage: string): string {
  return GAME_ERROR_MESSAGES[code] ?? fallbackMessage;
}
