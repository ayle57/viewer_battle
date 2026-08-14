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
 *
 * Pinned to `globalThis`, not a plain module-level variable — this bit
 * for real, the same way `src/server/sockets/instance.ts`'s `ioInstance`
 * did (see AGENTS.md): once `isHostConnected` started getting called
 * from the tRPC `session.join` procedure (which runs inside
 * `src/app/api/trpc/[trpc]/route.ts`'s module graph, hot-reloaded by
 * Next's Fast Refresh) instead of only from Socket.IO handlers (which run
 * inside `src/server/server.ts`'s own module graph, restarted whole by
 * `tsx watch`), a plain `const sessionPresence` gave each side its own,
 * disconnected Map — `registerPresenceHandlers` populated one instance,
 * `isHostConnected` read the other, forever empty, permanently rejecting
 * every join with HOST_NOT_CONNECTED even with a real host connected.
 * Caught by testing against the actual running dev server, not by the
 * automated suite, which spins up its own single-module-instance
 * `http.Server`+Socket.IO pair per test file and never exercises this
 * specific cross-module-instance path.
 */
type PresenceMap = Map<string, Map<string, { entry: PresenceEntry; sockets: number }>>;
const globalForPresence = globalThis as unknown as { sessionPresence?: PresenceMap };
const sessionPresence: PresenceMap = globalForPresence.sessionPresence ?? (globalForPresence.sessionPresence = new Map());

function snapshot(sessionId: string): PresenceEntry[] {
  const byParticipant = sessionPresence.get(sessionId);
  if (!byParticipant) return [];
  return Array.from(byParticipant.values(), (v) => v.entry);
}

/**
 * The real access-control fact "is the host actually here right now" —
 * used by joinSession (src/server/db/participant.ts) to gate NEW
 * Player/Display joins: a session code alone must never be enough to get
 * a seat, only a session with a genuinely connected host. Deliberately a
 * live presence check, not a DB flag — a host whose tab crashed without
 * a clean disconnect is caught by the same socket "disconnect" event
 * every other presence consumer relies on, nothing extra to maintain.
 */
export function isHostConnected(sessionId: string): boolean {
  const byParticipant = sessionPresence.get(sessionId);
  if (!byParticipant) return false;
  for (const { entry } of byParticipant.values()) {
    if (entry.role === "HOST") return true;
  }
  return false;
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
