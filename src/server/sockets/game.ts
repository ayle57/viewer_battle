import type { Server as SocketIOServer, Socket } from "socket.io";
import { gameRoomName } from "@/domain/game";
import type { SocketIdentity } from "@/server/auth";
import { applyGameAction, getCurrentGame, publicStateFor, type GameError } from "@/server/game";
import { logger } from "@/server/logger";

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
  const hostState = publicStateFor(gameKey, state, "HOST");
  io.to(gameRoomName(sessionId, "host")).emit("game:state", { gameId, gameKey, state: hostState, events });

  // TEAM_A stands in for "the public audience" here: BoardQuestionEngine
  // redacts identically for TEAM_A/TEAM_B/DISPLAY, so one emit covers the
  // whole "public" room. An engine whose redaction genuinely differs BY
  // team would need per-team rooms instead of a single shared one.
  const publicState = publicStateFor(gameKey, state, "TEAM_A");
  io.to(gameRoomName(sessionId, "public")).emit("game:state", { gameId, gameKey, state: publicState, events });
}
