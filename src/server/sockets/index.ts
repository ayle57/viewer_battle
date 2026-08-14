import { Server as SocketIOServer } from "socket.io";
import type { Server as HTTPServer } from "node:http";
import { logger } from "@/server/logger";

/**
 * Attaches Socket.IO to an existing http.Server.
 *
 * This file only owns the io instance and connection/disconnection
 * logging. Feature-specific auth middleware, rooms, and event handlers are
 * registered by dedicated modules (see src/server/sockets/chat.ts for the
 * first one) — this is the auth-middleware + room + broadcast pattern
 * proven during the Phase 0 spike, kept generic so more features can plug
 * into the same io instance the same way.
 */
export function createSocketServer(httpServer: HTTPServer) {
  const io = new SocketIOServer(httpServer, {
    path: "/socket.io",
  });

  io.on("connection", (socket) => {
    logger.info({ socketId: socket.id }, "socket connected");

    socket.on("disconnect", (reason) => {
      logger.info({ socketId: socket.id, reason }, "socket disconnected");
    });
  });

  return io;
}
