import { getGameEngine } from "@/domain/game";
import type { GameStatus } from "@/domain/game";
import type { ParticipantRole } from "@/domain/session";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";

/**
 * The bridge: Prisma <-> Game Kernel <-> Socket.IO/tRPC. Contains ZERO
 * gameplay rules — every branch here is either persistence or dispatch,
 * never "is this move legal" (that's entirely inside whatever engine
 * `getGameEngine` returns). See AGENTS.md "Vertical slice: SessionGame +
 * realtime bridge".
 */

const MAX_APPLY_ATTEMPTS = 5;

export interface GameError {
  code: string;
  message: string;
}

export interface GameActionSuccess {
  ok: true;
  gameId: string;
  gameKey: string;
  state: unknown;
  events: unknown[];
}
export interface GameActionFailure {
  ok: false;
  error: GameError;
}
export type GameActionResult = GameActionSuccess | GameActionFailure;

function isFinishedStatus(state: unknown): boolean {
  return typeof state === "object" && state !== null && (state as { status?: GameStatus }).status === "finished";
}

/** "The current game" for a session is just the most recently started one — see prisma/schema.prisma's SessionGame comment on why there's no separate "active game" pointer. */
export async function getCurrentGame(sessionId: string) {
  return prisma.sessionGame.findFirst({ where: { sessionId }, orderBy: { startedAt: "desc" } });
}

/** Starts a new game — the one place SessionGame rows get created. Refuses to start a second game while one is still in progress (simple guard against an accidental double-click; not a product rule about concurrent games). */
export async function startGame(sessionId: string, gameKey: string, config: unknown): Promise<GameActionResult> {
  const engine = getGameEngine(gameKey);
  if (!engine) {
    return { ok: false, error: { code: "UNKNOWN_GAME", message: `No engine registered for "${gameKey}".` } };
  }

  const current = await getCurrentGame(sessionId);
  if (current && current.status === "IN_PROGRESS") {
    return { ok: false, error: { code: "GAME_IN_PROGRESS", message: "A game is already in progress for this session." } };
  }

  const initialState = engine.createInitialState(config);
  const game = await prisma.sessionGame.create({
    data: { sessionId, gameKey, internalState: initialState as Prisma.InputJsonValue },
  });
  return { ok: true, gameId: game.id, gameKey: game.gameKey, state: initialState, events: [] };
}

/**
 * Loads the current game, applies one action, persists on success.
 *
 * Race safety is `SessionGame.version` (optimistic concurrency), not a
 * transaction wrapping the whole read-apply-write — a DB transaction
 * can't protect this anyway, since `engine.apply` runs in application
 * code between the read and the write, not in SQL. On a lost race
 * (`updateMany` matches zero rows because someone else's action already
 * bumped the version), this reloads the now-current state and retries
 * the SAME action from the top, bounded — so a losing caller gets a real
 * rejection reason from the engine (e.g. TEAM_ALREADY_ATTEMPTED,
 * WRONG_PHASE) instead of a generic "conflict, try again."
 */
export async function applyGameAction(sessionId: string, rawAction: unknown): Promise<GameActionResult> {
  for (let attempt = 0; attempt < MAX_APPLY_ATTEMPTS; attempt++) {
    const game = await getCurrentGame(sessionId);
    if (!game) {
      return { ok: false, error: { code: "GAME_NOT_FOUND", message: "No game is running for this session." } };
    }
    if (game.status === "FINISHED") {
      return { ok: false, error: { code: "GAME_ALREADY_FINISHED", message: "This game has already finished." } };
    }

    const engine = getGameEngine(game.gameKey);
    if (!engine) {
      return { ok: false, error: { code: "UNKNOWN_GAME", message: `No engine registered for "${game.gameKey}".` } };
    }

    const result = engine.apply(game.internalState, rawAction);
    if (!result.ok) {
      return { ok: false, error: result.error };
    }

    const finished = isFinishedStatus(result.state);
    const updated = await prisma.sessionGame.updateMany({
      where: { id: game.id, version: game.version },
      data: {
        internalState: result.state as Prisma.InputJsonValue,
        version: { increment: 1 },
        status: finished ? "FINISHED" : "IN_PROGRESS",
        finishedAt: finished ? new Date() : null,
      },
    });

    if (updated.count === 1) {
      return { ok: true, gameId: game.id, gameKey: game.gameKey, state: result.state, events: result.events };
    }
    // Lost the race — retry against whatever the winner just wrote.
  }

  return { ok: false, error: { code: "CONFLICT", message: "Too many concurrent updates — try again." } };
}

/** The view of a game's state that's safe to show `role` — see GameEngine.toPublicView. Falls back to the full state for an engine that doesn't define one. */
export function publicStateFor(gameKey: string, state: unknown, role: ParticipantRole): unknown {
  const engine = getGameEngine(gameKey);
  return engine?.toPublicView ? engine.toPublicView(state, role) : state;
}
