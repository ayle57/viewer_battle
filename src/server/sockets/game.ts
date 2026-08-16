import type { Server as SocketIOServer, Socket } from "socket.io";
import { gameAudienceForRole, gameRoomName } from "@/domain/game";
import type { ParticipantRole } from "@/domain/session";
import type { SocketIdentity } from "@/server/auth";
import { applyGameAction, getCurrentGame, publicStateFor, type GameError } from "@/server/game";
import { logger } from "@/server/logger";

/** Every concrete role `broadcastGameSnapshot` sends its own redacted `game:state` to — see rooms.ts's doc comment on why this is 4 targeted emits, not one shared "public" broadcast. */
const ALL_ROLES: readonly ParticipantRole[] = ["HOST", "TEAM_A", "TEAM_B", "DISPLAY"];

type GameActionAck = (
  response: { ok: true; state: unknown; events: unknown[] } | { ok: false; error: GameError },
) => void;

/**
 * Joins the socket to its game room and sends the current snapshot
 * immediately — this is what makes a page refresh / reconnect not lose
 * game state (see AGENTS.md "Vertical slice"). Registers `game:action`.
 *
 * Two rooms per session (src/domain/game/rooms.ts): HOST gets the full
 * state, everyone else gets whatever `engine.toPublicView` redacts for
 * them — never the same payload broadcast to both, since e.g. Jeopardy's
 * answer key must never reach a team's socket.
 */
export function registerGameHandlers(io: SocketIOServer, socket: Socket) {
  const identity = socket.data.identity as SocketIdentity;
  const audience = identity.role === "HOST" ? "host" : "public";
  socket.join(gameRoomName(identity.sessionId, audience));
  // Also join this exact role's own room — what broadcastGameSnapshot
  // below actually targets. Additive to the "host"/"public" join above
  // (never replacing it): presence.ts and session.ts's session:ended
  // still broadcast to "host"/"public" exactly as before, untouched.
  socket.join(gameRoomName(identity.sessionId, gameAudienceForRole(identity.role)));

  sendCurrentSnapshot(socket, identity).catch((error: unknown) => {
    logger.error({ error, socketId: socket.id }, "failed to load current game state");
  });

  socket.on("game:action", (payload: unknown, ack?: GameActionAck) => {
    void (async () => {
      // `by` is never taken from the client — always the resolved,
      // server-trusted identity, so a socket can never claim a role it
      // doesn't hold (see AGENTS.md).
      const action = { ...(isRecord(payload) ? payload : {}), by: identity.role };

      const result = await applyGameAction(identity.sessionId, action);

      if (!result.ok) {
        ack?.({ ok: false, error: result.error });
        return;
      }

      broadcastGameSnapshot(io, identity.sessionId, result.gameId, result.gameKey, result.state, result.events);
      ack?.({ ok: true, state: publicStateFor(result.gameKey, result.state, identity.role), events: result.events });
    })().catch((error: unknown) => {
      logger.error({ error, socketId: socket.id }, "failed to apply game action");
      ack?.({ ok: false, error: { code: "INTERNAL_ERROR", message: "Internal error" } });
    });
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function sendCurrentSnapshot(socket: Socket, identity: SocketIdentity) {
  const game = await getCurrentGame(identity.sessionId);
  if (!game) return; // no game running yet for this session — nothing to send
  const state = publicStateFor(game.gameKey, game.internalState, identity.role);
  socket.emit("game:state", { gameId: game.id, gameKey: game.gameKey, state, events: [] });
}

/**
 * Broadcasts a snapshot to both audience rooms for a session, each with
 * its own redacted view. Exported so the tRPC `game.start` mutation (not
 * itself a socket handler, but running in the same process — see
 * src/server/sockets/instance.ts) can notify already-connected clients
 * the same way an in-game action does.
 *
 * `gameId` is mandatory here on purpose (it used to be silently omitted —
 * see AGENTS.md): a socket that's already connected and already showing a
 * game only knows which game it's looking at via the `gameId` on the LAST
 * `game:state` it received. Omitting it on this path while
 * `sendCurrentSnapshot` always includes it meant any tab already open when
 * an action fired would have its own `gameId` clobbered back to null by
 * the very next broadcast — flipping an in-progress board back to "no
 * game running" client-side even though nothing was actually wrong.
 */
export function broadcastGameSnapshot(
  io: SocketIOServer,
  sessionId: string,
  gameId: string,
  gameKey: string,
  state: unknown,
  events: unknown[],
) {
  // One emit per CONCRETE role (see rooms.ts's doc comment) — every
  // engine gets genuinely correct per-role redaction this way, with no
  // "does this engine's redaction differ by team" special-casing here.
  // For an engine that redacts identically for every non-host role
  // (BoardQuestionEngine today), this sends three byte-identical
  // payloads to three different rooms instead of one shared broadcast —
  // functionally the same outcome for any client, at the cost of a few
  // extra cheap emits.
  for (const role of ALL_ROLES) {
    const roleState = publicStateFor(gameKey, state, role);
    io.to(gameRoomName(sessionId, gameAudienceForRole(role))).emit("game:state", { gameId, gameKey, state: roleState, events });
  }
}
