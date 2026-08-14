import { Server as SocketIOServer } from "socket.io";
import type { Server as HTTPServer } from "node:http";
import { logger } from "@/server/logger";
import { socketAuthMiddleware } from "@/server/sockets/auth";
import { registerChatHandlers } from "@/server/sockets/chat";
import { registerGameHandlers } from "@/server/sockets/game";
import { registerPresenceHandlers } from "@/server/sockets/presence";
import { setSocketServer } from "@/server/sockets/instance";

/**
 * Attaches Socket.IO to an existing http.Server and wires up every
 * realtime feature (auth middleware + rooms + broadcast — see
 * src/server/sockets/chat.ts and game.ts). This is the pattern proven
 * during the Phase 0 spike: more realtime features register the same
 * way, each in their own module, plugged in here.
 */
export function createSocketServer(httpServer: HTTPServer) {
  const io = new SocketIOServer(httpServer, {
    path: "/socket.io",
  });

  setSocketServer(io); // lets non-socket code (the tRPC game.start mutation) reach this instance — see instance.ts

  io.use(socketAuthMiddleware);

  io.on("connection", (socket) => {
    logger.info({ socketId: socket.id, identity: socket.data.identity }, "socket connected");

    registerChatHandlers(io, socket);
    registerGameHandlers(io, socket);
    registerPresenceHandlers(io, socket);

    socket.on("disconnect", (reason) => {
      logger.info({ socketId: socket.id, reason }, "socket disconnected");
    });
  });

  return io;
}
