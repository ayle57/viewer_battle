import { initTRPC } from "@trpc/server";
import { SessionError } from "@/domain/session";
import { ContentError } from "@/domain/content";
import { UserError } from "@/domain/user";

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
 *   - error.data.contentErrorCode — cause is a ContentError
 *     (src/domain/content/errors.ts), thrown via
 *     src/server/trpc/contentErrors.ts's toContentTRPCError. A separate
 *     field from sessionErrorCode/gameErrorCode on purpose: Content Studio
 *     is a deliberately separate identity system (ContentHost, not
 *     Participant) — see prisma/schema.prisma's "Content Studio" comment.
 *   - error.data.userErrorCode — cause is a UserError
 *     (src/domain/user/errors.ts), thrown via
 *     src/server/trpc/userErrors.ts's toUserTRPCError. Also its own
 *     field, same reasoning as contentErrorCode: a real `User` account is
 *     a THIRD identity system, separate from both Participant and
 *     ContentHost (see prisma/schema.prisma's User doc comment).
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
        contentErrorCode: cause instanceof ContentError ? cause.code : undefined,
        userErrorCode: cause instanceof UserError ? cause.code : undefined,
        gameErrorCode:
          !(cause instanceof SessionError) && !(cause instanceof ContentError) && !(cause instanceof UserError) && hasStringCode(cause)
            ? cause.code
            : undefined,
      },
    };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;
