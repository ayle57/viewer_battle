import type { Server as SocketIOServer, Socket } from "socket.io";
import type { SocketIdentity } from "@/server/auth";
import { gameRoomName } from "@/domain/game";

export interface PresenceEntry {
  participantId: string;
  role: SocketIdentity["role"];
  displayName: string;
}

/**
 * Who's actually connected right now, per session — real, not a proxy for
 * it: refcounted by socket (one participant can hold more than one open
 * tab/socket; they only leave presence once the LAST one disconnects), and
 * entirely in-memory (a server restart legitimately means "everyone just
 * disconnected," which is correct — presence has never claimed to survive
 * that, unlike game state).
 *
 * Not persisted, not part of SessionGame — this is transport-layer
 * information (who's online), never gameplay, so it stays out of the Game
 * Kernel and out of Prisma entirely. Broadcast to both the host and public
 * game rooms (see src/domain/game/rooms.ts) since who's connected isn't a
 * secret the way an answer key is.
 */
const sessionPresence = new Map<string, Map<string, { entry: PresenceEntry; sockets: number }>>();

function snapshot(sessionId: string): PresenceEntry[] {
  const byParticipant = sessionPresence.get(sessionId);
  if (!byParticipant) return [];
  return Array.from(byParticipant.values(), (v) => v.entry);
}

function broadcast(io: SocketIOServer, sessionId: string) {
  const participants = snapshot(sessionId);
  io.to(gameRoomName(sessionId, "host")).emit("presence:update", { participants });
  io.to(gameRoomName(sessionId, "public")).emit("presence:update", { participants });
}

export function registerPresenceHandlers(io: SocketIOServer, socket: Socket) {
  const identity = socket.data.identity as SocketIdentity;

  let byParticipant = sessionPresence.get(identity.sessionId);
  if (!byParticipant) {
    byParticipant = new Map();
    sessionPresence.set(identity.sessionId, byParticipant);
  }
  const existing = byParticipant.get(identity.participantId);
  if (existing) {
    existing.sockets += 1;
  } else {
    byParticipant.set(identity.participantId, {
      entry: { participantId: identity.participantId, role: identity.role, displayName: identity.displayName },
      sockets: 1,
    });
  }
  broadcast(io, identity.sessionId);

  // Send the current snapshot straight to this socket too — it joined
  // after everyone else's presence was already established, so it would
  // otherwise only ever see itself until the NEXT connect/disconnect.
  socket.emit("presence:update", { participants: snapshot(identity.sessionId) });

  socket.on("disconnect", () => {
    const participants = sessionPresence.get(identity.sessionId);
    const record = participants?.get(identity.participantId);
    if (!record) return;
    record.sockets -= 1;
    if (record.sockets <= 0) {
      participants?.delete(identity.participantId);
      if (participants?.size === 0) sessionPresence.delete(identity.sessionId);
    }
    broadcast(io, identity.sessionId);
  });
}
