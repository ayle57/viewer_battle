import type { Server as SocketIOServer } from "socket.io";
import { gameRoomName } from "@/domain/game";
import { participantRoomName } from "@/domain/session";

/**
 * The one real-time signal a session ending gets — sent to both audience
 * rooms (host + public, the same split `game:state` uses) right before
 * the tRPC `session.finish` handler actually calls `endSession`
 * (src/server/db/session.ts, a soft `status: "FINISHED"` update). A
 * currently-connected client hears this the instant it happens, instead
 * of waiting on its next `session.getState` poll to observe the same
 * status flip on its own — both roads lead to the same graceful "session
 * ended" screen (deriveSessionPhase, sessionPhase.ts), this is just the
 * instant one. See gameStore.ts's `sessionEnded` for where this lands
 * client-side.
 */
export function broadcastSessionEnded(io: SocketIOServer, sessionId: string) {
  io.to(gameRoomName(sessionId, "host")).emit("session:ended");
  io.to(gameRoomName(sessionId, "public")).emit("session:ended");
}

/**
 * A REAL, REPRODUCED bug this closes: `rotateSessionCode` (and `kick`,
 * which also rotates as part of removing someone) only ever changed the
 * `Session.code` COLUMN — every already-connected socket keeps working
 * fine (auth is by token, never by code, exactly as `rotateCode`'s own
 * router.ts doc comment already claims), but every client ALSO polls
 * `session.getState({ sessionCode: identity.sessionCode })` on a plain
 * timer, using whatever code it captured at JOIN time
 * (`identityStore.ts`, sessionStorage) — nothing ever told it the code
 * just changed underneath it. `getSessionState` looks up `WHERE code:
 * sessionCode` (src/server/db/session.ts) — an exact match — so that
 * poll starts failing with `SESSION_NOT_FOUND`, FOREVER, the instant
 * rotation happens. Confirmed directly: an already-connected, actively
 * playing participant's OWN screen flips to "Session ended — thanks for
 * playing!" (sessionPhase.ts treats `SESSION_NOT_FOUND` the same as a
 * real end, player/page.tsx's own `sessionEnded` derivation) even though
 * the session is 100% alive and their socket keeps working underneath
 * the misleading screen. Same shape as `broadcastSessionEnded` above —
 * every already-connected client (both teams, Display, and any OTHER
 * Host tab — only the tab that TRIGGERED the rotation gets the new code
 * back from its own mutation response) hears the fresh code in real
 * time and can keep its own `identity.sessionCode` (and therefore its
 * `session.getState` polling) correct without ever needing to notice
 * anything happened.
 */
export function broadcastSessionCodeRotated(io: SocketIOServer, sessionId: string, newCode: string) {
  io.to(gameRoomName(sessionId, "host")).emit("session:code-rotated", { code: newCode });
  io.to(gameRoomName(sessionId, "public")).emit("session:code-rotated", { code: newCode });
}

/**
 * Tells exactly the kicked participant (every socket/tab they hold —
 * see domain/session/rooms.ts's `participantRoomName`) they've been
 * removed, then forcibly closes those socket(s) — unlike
 * broadcastSessionEnded, no one ELSE in the session needs to hear this
 * (their teammate/opponent/display just sees the seat go empty on the
 * next `presence:update`, fired automatically by each disconnecting
 * socket's own "disconnect" handler, same as any other disconnect).
 * `participant:kicked` first, THEN disconnect — Socket.IO flushes queued
 * emits before a `disconnectSockets` close actually tears down the
 * transport, so the client is guaranteed to receive this before its
 * connection dies.
 */
export function broadcastParticipantKicked(io: SocketIOServer, participantId: string) {
  const room = participantRoomName(participantId);
  io.to(room).emit("participant:kicked");
  io.in(room).disconnectSockets(true);
}
