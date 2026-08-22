/**
 * Business error codes -> readable text, GeoGuessr's own copy of
 * boardQuestion/gameErrorMessages.ts's pattern — a separate small map,
 * not a shared import from the `boardQuestion` folder, so this feature
 * has zero coupling to Jeopardy's own files. Pure presentation; the
 * actual rule lives server-side (src/domain/game/geoGuessr/engine.ts).
 */
const GEO_ERROR_MESSAGES: Record<string, string> = {
  INVALID_ACTION: "That action wasn't valid — try again.",
  UNKNOWN_ACTION: "That action isn't supported.",
  WRONG_PHASE: "You can't do that right now.",
  FORBIDDEN_ROLE: "You're not allowed to do that.",
  GAME_ALREADY_FINISHED: "This game has already finished.",
  ROUND_NOT_FOUND: "That round doesn't exist.",
  TEAM_ALREADY_LOCKED: "Your team has already locked in this round.",
  NO_GUESS_SET: "Place a guess on the map before locking it in.",
  NO_ROUNDS_REMAINING: "There are no more rounds to play.",
  NO_COUNTDOWN_ACTIVE: "There's no countdown running to cancel.",
  GAME_NOT_FOUND: "No game is running yet.",
  GAME_IN_PROGRESS: "A game is already in progress.",
  UNKNOWN_GAME: "Unknown game type.",
  CONFLICT: "Someone else acted at the same moment — try again.",
  INTERNAL_ERROR: "Something went wrong on our end.",
};

export function readableGeoError(code: string, fallbackMessage: string): string {
  return GEO_ERROR_MESSAGES[code] ?? fallbackMessage;
}
