import { Server as SocketIOServer } from "socket.io";
import type { Server as HTTPServer } from "node:http";
import { logger } from "@/server/logger";
import { chatAuthMiddleware, registerChatHandlers } from "@/server/sockets/chat";

/**
 * Attaches Socket.IO to an existing http.Server and wires up the chat
 * feature (auth middleware + rooms + broadcast — see
 * src/server/sockets/chat.ts). This is the pattern proven during the
 * Phase 0 spike: more realtime features register the same way, each in
 * their own module, plugged in here.
 */
export function createSocketServer(httpServer: HTTPServer) {
  const io = new SocketIOServer(httpServer, {
    path: "/socket.io",
  });

  io.use(chatAuthMiddleware);

  io.on("connection", (socket) => {
    logger.info({ socketId: socket.id, identity: socket.data.identity }, "socket connected");

    registerChatHandlers(io, socket);

    socket.on("disconnect", (reason) => {
      logger.info({ socketId: socket.id, reason }, "socket disconnected");
    });
  });

  return io;
}
