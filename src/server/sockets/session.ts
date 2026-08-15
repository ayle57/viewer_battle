import type { Server as SocketIOServer } from "socket.io";
import { gameRoomName } from "@/domain/game";

/**
 * The one real-time signal a session's own deletion gets — sent to both
 * audience rooms (host + public, the same split `game:state` uses) right
 * before the tRPC `session.finish` handler actually calls
 * `endSession`/`prisma.session.delete` (src/server/db/session.ts). A
 * currently-connected client hears this the instant it happens, instead
 * of finding out on its next `session.getState` poll — which, once the
 * row is truly gone, would 404 rather than gracefully read back
 * `status: "FINISHED"` the way the old soft-finish design relied on. See
 * gameStore.ts's `sessionEnded` for where this lands client-side.
 */
export function broadcastSessionEnded(io: SocketIOServer, sessionId: string) {
  io.to(gameRoomName(sessionId, "host")).emit("session:ended");
  io.to(gameRoomName(sessionId, "public")).emit("session:ended");
}
