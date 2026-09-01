/**
 * Business error codes -> readable text, Drawing's own copy of
 * boardQuestion/gameErrorMessages.ts's / geoGuessr's pattern — a
 * separate small map, not a shared import from either other folder, so
 * this feature has zero coupling to Jeopardy's/GeoGuessr's own files.
 * Pure presentation; the actual rule lives server-side
 * (src/domain/game/drawing/engine.ts). Drawing's own engine adds no
 * error codes beyond the shared KernelErrorCode set plus its own
 * NO_COUNTDOWN_ACTIVE/NO_PROMPTS_REMAINING (types.ts's `DrawingErrorCode`)
 * — a genuinely simpler engine than either other one.
 */
const DRAWING_ERROR_MESSAGES: Record<string, string> = {
  INVALID_ACTION: "That action wasn't valid — try again.",
  UNKNOWN_ACTION: "That action isn't supported.",
  WRONG_PHASE: "You can't do that right now.",
  FORBIDDEN_ROLE: "You're not allowed to do that.",
  GAME_ALREADY_FINISHED: "This game has already finished.",
  NO_COUNTDOWN_ACTIVE: "There's no drawing countdown running to adjust.",
  NO_PROMPTS_REMAINING: "There are no more prompts to play.",
  GAME_NOT_FOUND: "No game is running yet.",
  GAME_IN_PROGRESS: "A game is already in progress.",
  UNKNOWN_GAME: "Unknown game type.",
  CONFLICT: "Someone else acted at the same moment — try again.",
  INTERNAL_ERROR: "Something went wrong on our end.",
};

export function readableDrawingError(code: string, fallbackMessage: string): string {
  return DRAWING_ERROR_MESSAGES[code] ?? fallbackMessage;
}
