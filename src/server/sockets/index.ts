import { Server as SocketIOServer } from "socket.io";
import type { Server as HTTPServer } from "node:http";
import { logger } from "@/server/logger";

export interface CreateSocketServerOptions {
  /**
   * Token every connecting client must present in the handshake
   * (`socket.handshake.auth.token`). Defaults to process.env.SPIKE_TOKEN.
   *
   * This is a Phase 0 stand-in for the real auth design (hashed player /
   * display tokens verified against Postgres, host session cookie) — it
   * only exists to prove the io.use() middleware pattern itself works:
   * reject bad credentials, accept good ones, before any handler runs.
   */
  expectedToken?: string;
}

/**
 * Attaches Socket.IO to an existing http.Server and wires up the Phase 0
 * spike events:
 *   - auth middleware (io.use) rejecting connections without a valid token
 *   - "spike:join-room" — join an arbitrary room
 *   - "spike:ping" — broadcast "spike:pong" to everyone in a room
 *
 * This function is imported both by src/server/server.ts (real process)
 * and by tests/integration/socket.test.ts (in-process, no real HTTP
 * listen needed) so the exact same wiring is what gets tested.
 */
export function createSocketServer(httpServer: HTTPServer, options: CreateSocketServerOptions = {}) {
  const expectedToken = options.expectedToken ?? process.env.SPIKE_TOKEN;

  const io = new SocketIOServer(httpServer, {
    path: "/socket.io",
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!expectedToken || token !== expectedToken) {
      logger.warn({ socketId: socket.id }, "socket auth rejected");
      next(new Error("unauthorized"));
      return;
    }
    next();
  });

  io.on("connection", (socket) => {
    logger.info({ socketId: socket.id }, "socket connected");

    socket.on("spike:join-room", (room: string, ack?: (ok: boolean) => void) => {
      socket.join(room);
      ack?.(true);
    });

    socket.on("spike:ping", (payload: { room: string; message: string }) => {
      io.to(payload.room).emit("spike:pong", {
        message: payload.message,
        from: socket.id,
      });
    });

    socket.on("disconnect", (reason) => {
      logger.info({ socketId: socket.id, reason }, "socket disconnected");
    });
  });

  return io;
}
