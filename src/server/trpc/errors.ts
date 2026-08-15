import { TRPCError } from "@trpc/server";
import { SessionError, type SessionErrorCode } from "@/domain/session";

const TRPC_CODE: Record<SessionErrorCode, TRPCError["code"]> = {
  SESSION_NOT_FOUND: "NOT_FOUND",
  SESSION_CLOSED: "BAD_REQUEST",
  HOST_ALREADY_CONNECTED: "CONFLICT",
  HOST_NOT_CONNECTED: "FORBIDDEN",
  TEAM_FULL: "CONFLICT",
  INVALID_TOKEN: "UNAUTHORIZED",
  INVALID_HOST_KEY: "UNAUTHORIZED",
  INVALID_HOST_PASSWORD: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
};

/**
 * Converts a SessionError (thrown from src/server/db) into a TRPCError,
 * preserving the business code as `cause` so trpc.ts's errorFormatter can
 * put it on the wire as error.data.sessionErrorCode. The one place this
 * mapping happens — see src/server/sockets/chat.ts for Socket.IO's
 * equivalent, equally thin, translation of the same SessionError.
 */
export function toTRPCError(error: unknown): TRPCError {
  if (error instanceof SessionError) {
    return new TRPCError({ code: TRPC_CODE[error.code], message: error.message, cause: error });
  }
  if (error instanceof TRPCError) return error;
  return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Internal error", cause: error });
}
