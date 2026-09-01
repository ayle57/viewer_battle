/**
 * Business error codes -> readable text — the Pointing System counterpart
 * to boardQuestion/gameErrorMessages.ts / steamRatings/gameErrorMessages.ts
 * / etc. Pure presentation/translation, same posture as those: the actual
 * rule that produced the code is enforced server-side
 * (src/domain/game/pointingSystem, src/server/game); this file doesn't
 * decide anything. Shared by host/player/display so the same code reads
 * the same way everywhere. Shorter than the other engines' own copies —
 * this engine only ever produces the generic KernelErrorCode set (no
 * rounds/phases of its own to have a specific error about).
 */
const GAME_ERROR_MESSAGES: Record<string, string> = {
  INVALID_ACTION: "That wasn't valid — try again.",
  UNKNOWN_ACTION: "That action isn't supported.",
  WRONG_PHASE: "You can't do that right now.",
  FORBIDDEN_ROLE: "You're not allowed to do that.",
  GAME_ALREADY_FINISHED: "This game has already finished.",
  GAME_NOT_FOUND: "No game is running yet.",
  GAME_IN_PROGRESS: "A game is already in progress.",
  UNKNOWN_GAME: "Unknown game type.",
  CONFLICT: "Someone else acted at the same moment — try again.",
  INTERNAL_ERROR: "Something went wrong on our end.",
};

export function readablePointingSystemError(code: string, fallbackMessage: string): string {
  return GAME_ERROR_MESSAGES[code] ?? fallbackMessage;
}
