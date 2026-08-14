import { initTRPC } from "@trpc/server";
import { SessionError } from "@/domain/session";

/**
 * tRPC is used for request/response CRUD and admin operations only
 * (content management, session/team/player setup, auth, stats).
 * All realtime traffic goes through Socket.IO — see src/server/sockets.
 *
 * errorFormatter exposes SessionError's business code on the client-visible
 * error shape (error.data.sessionErrorCode) — so the UI can branch on
 * TEAM_FULL / HOST_ALREADY_CONNECTED / etc. instead of parsing a message
 * string. Procedures throw via src/server/trpc/errors.ts's toTRPCError,
 * which attaches the SessionError as `cause`.
 */
const t = initTRPC.create({
  errorFormatter({ shape, error }) {
    const cause = error.cause;
    return {
      ...shape,
      data: {
        ...shape.data,
        sessionErrorCode: cause instanceof SessionError ? cause.code : undefined,
      },
    };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;
