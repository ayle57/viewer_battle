/**
 * SessionErrorCode -> readable text for the product join/connexion
 * screens — pure presentation, same spirit as boardQuestion's
 * gameErrorMessages.ts. The actual rule lives entirely server-side
 * (src/domain/session/errors.ts); this only describes what already
 * happened, in words a player/host/display screen can show as-is.
 */
const SESSION_ERROR_MESSAGES: Record<string, string> = {
  SESSION_NOT_FOUND: "No game found with that code — double-check it with the host.",
  SESSION_CLOSED: "This game has already finished.",
  HOST_ALREADY_CONNECTED: "This game already has a host.",
  HOST_NOT_CONNECTED: "Waiting for the host — this game isn't ready to join yet.",
  TEAM_FULL: "That team is already full.",
  INVALID_TOKEN: "Your session expired — please rejoin.",
  INVALID_HOST_KEY: "That recovery key doesn't match this session code.",
  INVALID_HOST_PASSWORD: "That password isn't correct.",
  FORBIDDEN: "You don't have permission to do that.",
};

export function readableSessionError(code: string | undefined, fallbackMessage: string): string {
  if (!code) return fallbackMessage;
  return SESSION_ERROR_MESSAGES[code] ?? fallbackMessage;
}
