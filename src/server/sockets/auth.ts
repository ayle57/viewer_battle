import type { Socket } from "socket.io";
import { SessionError, type SessionErrorCode } from "@/domain/session";
import { resolveIdentity } from "@/server/auth";
import { logger } from "@/server/logger";

/**
 * Socket.IO auth middleware, shared by every realtime feature (chat,
 * game, ...) — resolves the connecting socket's identity (see
 * src/server/auth) once and attaches it to `socket.data.identity`.
 * Register with `io.use(socketAuthMiddleware)` before any feature's
 * connection handler.
 *
 * Rejections carry the same SessionError business code tRPC exposes (see
 * src/server/trpc/errors.ts) — as both the error message
 * (`connect_error.message` alone is already useful) and `.data.code` (the
 * structured form). One resolver, one error type, one auth middleware —
 * not a copy per feature.
 */
export function socketAuthMiddleware(socket: Socket, next: (err?: Error) => void) {
  resolveIdentity(socket.handshake.auth)
    .then((identity) => {
      socket.data.identity = identity;
      next();
    })
    .catch((error: unknown) => {
      logger.warn({ socketId: socket.id, error }, "socket auth rejected");
      const code: SessionErrorCode = error instanceof SessionError ? error.code : "INVALID_TOKEN";
      const err = new Error(code) as Error & { data?: { code: SessionErrorCode } };
      err.data = { code };
      next(err);
    });
}
