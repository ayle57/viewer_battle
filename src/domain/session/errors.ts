/**
 * Explicit, UI-actionable business error codes for session/participant
 * operations — never a generic error. Thrown from src/server/db (the I/O
 * layer) and mapped to a transport-specific shape at the edge:
 *   - tRPC: src/server/trpc/errors.ts -> TRPCError with this code on
 *     error.data.sessionErrorCode.
 *   - Socket.IO: src/server/sockets/chat.ts's auth middleware -> the
 *     connect_error's message/data.
 * One place throws these; each transport just translates, so tRPC and
 * Socket.IO never duplicate the actual authorization logic.
 */
export type SessionErrorCode =
  | "SESSION_NOT_FOUND"
  | "SESSION_CLOSED"
  | "HOST_ALREADY_CONNECTED"
  | "HOST_NOT_CONNECTED"
  | "TEAM_FULL"
  | "INVALID_TOKEN"
  | "INVALID_HOST_KEY"
  | "INVALID_HOST_PASSWORD"
  | "FORBIDDEN"
  | "PARTICIPANT_NOT_FOUND"
  | "DISPLAY_NAME_MATCHES_ACCOUNT";

const MESSAGES: Record<SessionErrorCode, string> = {
  SESSION_NOT_FOUND: "No session with that code exists.",
  SESSION_CLOSED: "This session has finished and can no longer be joined.",
  HOST_ALREADY_CONNECTED: "This session already has a host.",
  HOST_NOT_CONNECTED: "The host isn't connected yet — this game isn't ready to join.",
  TEAM_FULL: "This team already has 2 players.",
  INVALID_TOKEN: "This token is invalid or has expired.",
  INVALID_HOST_KEY: "That recovery key doesn't match this session.",
  INVALID_HOST_PASSWORD: "That password isn't correct.",
  FORBIDDEN: "You don't have permission to do that.",
  PARTICIPANT_NOT_FOUND: "That participant isn't in this session.",
  // The "compte provisoire" join (a plain display name, no login) can
  // freely pick any name — EXCEPT one that's actually a real account's
  // username, which would let anyone impersonate a specific streamer or
  // viewer just by typing their exact name. Only fires when the joiner
  // ISN'T signed into that account themselves (see joinSession's own
  // check) — the real account holder typing their own username as their
  // display name is exactly who they say they are.
  DISPLAY_NAME_MATCHES_ACCOUNT: "That name belongs to a real account — pick a different one, or log in to that account instead.",
};

export class SessionError extends Error {
  readonly code: SessionErrorCode;

  constructor(code: SessionErrorCode) {
    super(MESSAGES[code]);
    this.name = "SessionError";
    this.code = code;
  }
}
