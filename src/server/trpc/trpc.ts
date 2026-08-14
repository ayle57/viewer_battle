import { initTRPC } from "@trpc/server";
import { SessionError } from "@/domain/session";

/**
 * tRPC is used for request/response CRUD and admin operations only
 * (content management, session/team/player setup, auth, stats).
 * All realtime traffic goes through Socket.IO — see src/server/sockets.
 *
 * errorFormatter exposes a business error code on the client-visible
 * error shape, so the UI can branch on TEAM_FULL / GAME_IN_PROGRESS /
 * etc. instead of parsing a message string:
 *   - error.data.sessionErrorCode — cause is a SessionError
 *     (src/domain/session/errors.ts), thrown via
 *     src/server/trpc/errors.ts's toTRPCError.
 *   - error.data.gameErrorCode — cause is a src/server/game bridge error
 *     ({ code, message }, e.g. GAME_IN_PROGRESS, GAME_NOT_FOUND) or a
 *     GameError from an engine's own EngineResult (e.g.
 *     TEAM_ALREADY_ATTEMPTED). Same shape either way, so one field covers
 *     both without the client needing to know which layer rejected it.
 */
function hasStringCode(value: unknown): value is { code: string } {
  return typeof value === "object" && value !== null && typeof (value as { code?: unknown }).code === "string";
}

const t = initTRPC.create({
  errorFormatter({ shape, error }) {
    const cause = error.cause;
    return {
      ...shape,
      data: {
        ...shape.data,
        sessionErrorCode: cause instanceof SessionError ? cause.code : undefined,
        gameErrorCode: !(cause instanceof SessionError) && hasStringCode(cause) ? cause.code : undefined,
      },
    };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;
