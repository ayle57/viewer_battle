import type { Server as SocketIOServer, Socket } from "socket.io";
import { gameAudienceForRole, gameRoomName, remainingMs } from "@/domain/game";
import type { ParticipantRole } from "@/domain/session";
import type { SocketIdentity } from "@/server/auth";
import { applyGameAction, getCurrentGame, publicStateFor, type GameError } from "@/server/game";
import { logger } from "@/server/logger";
import { cancelGameEndTimer, scheduleGameEndTimer } from "./gameEndTimers";

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
      // doesn't hold (see AGENTS.md). `byName`/`nowMs` ride along the
      // same way, for engines that attach a player-level label to a
      // per-player action (GeoGuessr's SET_GUESS proposals — see
      // GeoProposal's own doc comment) or that schedule a deadline off
      // the current time (GeoGuessr's START_COUNTDOWN — never
      // client-controlled, so a client can't manipulate its own
      // deadline by lying about the current time). An engine whose
      // actions don't declare these fields just has them silently
      // stripped by that action's own zod schema, so this is safe to
      // always include.
      const action = { ...(isRecord(payload) ? payload : {}), by: identity.role, byName: identity.displayName, nowMs: Date.now() };

      const result = await applyGameAction(identity.sessionId, action);

      if (!result.ok) {
        ack?.({ ok: false, error: result.error });
        return;
      }

      scheduleCountdownIfAny(io, identity.sessionId, result.gameId, result.gameKey, result.events);
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

/**
 * The PRIMARY (real-time) half of the countdown feature
 * (src/domain/game/countdown.ts) — see gameEndTimers.ts's own doc
 * comment for the registry this drives, and each engine's own
 * `checkExpiry` for the SAFETY-NET half this complements. Engine-agnostic
 * on purpose, same posture as the rest of this file: it only ever
 * reacts to EVENT SHAPES (`COUNTDOWN_STARTED`/`COUNTDOWN_CANCELLED`),
 * never to a specific `gameKey` — proven by BoardQuestion/Mini Jeopardy
 * getting the exact same real-time mechanism for free the moment it
 * started emitting these same two event shapes, zero changes needed
 * here. What firing actually DOES is dispatching a plain
 * COUNTDOWN_EXPIRED action (below) — each engine decides what that
 * means for its own game, this file never does.
 */
function scheduleCountdownIfAny(io: SocketIOServer, sessionId: string, gameId: string, gameKey: string, events: unknown[]): void {
  for (const event of events) {
    if (!isRecord(event) || typeof event.type !== "string") continue;

    if (event.type === "COUNTDOWN_STARTED" && typeof event.deadlineMs === "number") {
      // The event's own `deadlineMs`, not a re-derived `durationMs` — see
      // CountdownStartedEvent's own doc comment on why: the ACTUAL
      // remaining time (this action's processing + the trip back here
      // already ate a sliver of it) is what the real-time timer should
      // fire against, so it lands at the exact same wall-clock moment
      // `checkExpiry`'s pure `isExpired` check would independently agree
      // the deadline passed — never a moment earlier.
      const deadlineMs = event.deadlineMs;
      scheduleGameEndTimer(gameId, remainingMs(deadlineMs, Date.now()), () => {
        void (async () => {
          // Re-dispatches through the ordinary COUNTDOWN_EXPIRED path —
          // NOT a hardcoded END_GAME (that was this feature's original
          // shape, back when a countdown could only ever mean "end the
          // whole game" — see src/domain/game/countdown.ts's own doc
          // comment on why this is now genuinely per-engine: GeoGuessr's
          // own COUNTDOWN_EXPIRED handler force-resolves the current
          // ROUND and only ends the game if that was the last one;
          // BoardQuestion's still just ends the game, same as END_GAME
          // always did there). A harmless no-op if the game already
          // finished or this countdown was cancelled/replaced by then
          // (GAME_ALREADY_FINISHED, or this exact timer having already
          // been cancelled so it never fires at all) —
          // `applyGameAction`'s own `{ ok: false }` result is simply
          // ignored here, nothing to ack, nobody's waiting on this
          // specific call.
          const result = await applyGameAction(sessionId, { type: "COUNTDOWN_EXPIRED", by: "HOST" });
          if (result.ok) broadcastGameSnapshot(io, sessionId, result.gameId, result.gameKey, result.state, result.events);
        })().catch((error: unknown) => {
          logger.error({ error, sessionId, gameId }, "failed to resolve expired countdown");
        });
      });
    }

    if (event.type === "COUNTDOWN_CANCELLED") cancelGameEndTimer(gameId);

    // A finished game never has a pending countdown left to fire —
    // whatever ended it (END_GAME, this very countdown expiring, or a
    // natural last-round finish, see finishGameNow's own doc comment)
    // clears it in `state`, so the real-time timer that might STILL be
    // scheduled (e.g. the game finished naturally before this
    // countdown's own deadline) needs clearing too — same "don't leave
    // dead Node timers around" hygiene gameEndTimers.ts's own doc
    // comment mentions. Checked via the event, not a blanket
    // unconditional cancel at the end of this function — that would
    // cancel the timer this SAME call just scheduled a few lines above,
    // for the ordinary "just started a countdown" case.
    if (event.type === "GAME_FINISHED") cancelGameEndTimer(gameId);
  }

  void gameKey; // kept in the signature for symmetry with broadcastGameSnapshot's own call shape, not read here — see this function's own doc comment on staying engine-agnostic
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
