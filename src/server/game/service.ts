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

/** The plain, no-side-effects read — "the current game" for a session is just the most recently started one, see prisma/schema.prisma's SessionGame comment on why there's no separate "active game" pointer. */
function findLatestGameRow(sessionId: string) {
  return prisma.sessionGame.findFirst({ where: { sessionId }, orderBy: { startedAt: "desc" } });
}

/**
 * The self-healing read — every caller EXCEPT `applyGameAction` itself
 * (see that function's own doc comment on why it deliberately reads
 * `findLatestGameRow` directly instead) gets a game whose `checkExpiry`
 * (kernel.ts) has already been resolved if needed, with nothing extra to
 * remember at each call site: `sendCurrentSnapshot`/`session.getState`'s
 * reads (a reconnect, a poll) always see a genuinely current game, never
 * a permanently stuck expired deadline nobody ever acted on.
 *
 * This is the SAFETY-NET path (`checkExpiry`'s own doc comment in
 * geoGuessr/engine.ts explains the primary, real-time one: the server's
 * own scheduled countdown timer, src/server/sockets/game.ts) — cheap
 * when there's nothing to check (an engine with no `checkExpiry` at all,
 * or one that returns `null`, costs one extra pure-function call and
 * nothing else), and self-correcting even if the primary timer was lost
 * (a process restart, or — very real for this project's own `pnpm dev`,
 * running `tsx watch` — a hot reload mid-countdown): the game's session
 * is polled every 2s by the Host's own `session.getState` regardless
 * (src/app/host/page.tsx), so even in that degraded case the game
 * self-heals within a couple of seconds of the primary timer being
 * lost, not never.
 */
export async function getCurrentGame(sessionId: string) {
  const game = await findLatestGameRow(sessionId);
  if (!game || game.status === "FINISHED") return game;

  const engine = getGameEngine(game.gameKey);
  const expired = engine?.checkExpiry?.(game.internalState, Date.now());
  if (!expired) return game;

  const finished = isFinishedStatus(expired);
  const updated = await prisma.sessionGame.updateMany({
    where: { id: game.id, version: game.version },
    data: {
      internalState: expired as Prisma.InputJsonValue,
      version: { increment: 1 },
      status: finished ? "FINISHED" : "IN_PROGRESS",
      finishedAt: finished ? new Date() : null,
    },
  });
  // Lost the race (someone else's real action, or another concurrent
  // expiry check, already wrote first) — the DB row is now more current
  // than anything we could construct locally, so just re-read it rather
  // than guessing at a merged shape.
  if (updated.count === 0) return prisma.sessionGame.findUnique({ where: { id: game.id } });

  return { ...game, internalState: expired, version: game.version + 1, status: finished ? ("FINISHED" as const) : ("IN_PROGRESS" as const), finishedAt: finished ? new Date() : null };
}

/**
 * Starts a new game — the one place SessionGame rows get created.
 * Refuses to start a second game while one is still in progress (simple
 * guard against an accidental double-click; not a product rule about
 * concurrent games).
 *
 * `playlistId` is purely provenance metadata (see prisma/schema.prisma's
 * SessionGame.playlistId comment) — it records WHICH Content Studio
 * Playlist (if any) `config` was snapshotted from, for the "this playlist
 * is currently live" banner. It plays no role in gameplay: `config` is
 * already the fully independent snapshot (built by
 * src/domain/content's playlistToBoardQuestionConfig, called by the tRPC
 * `game.start` handler BEFORE this function ever runs), so passing or
 * omitting `playlistId` cannot change what the engine does with it.
 */
export async function startGame(
  sessionId: string,
  gameKey: string,
  config: unknown,
  playlistId?: string | null,
): Promise<GameActionResult> {
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
    data: { sessionId, gameKey, internalState: initialState as Prisma.InputJsonValue, playlistId: playlistId ?? null },
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
 *
 * Deliberately `findLatestGameRow`, NOT the self-healing `getCurrentGame`
 * — a REAL, REPRODUCED bug the other way around: the server's own
 * real-time countdown timer (src/server/sockets/game.ts) fires and calls
 * THIS function with a plain END_GAME action once a deadline passes.
 * With `getCurrentGame` here, that load would self-heal the SAME
 * expiry the instant it read the row — finishing the game as a
 * side-effect of the read — and the very next line's own
 * `GAME_ALREADY_FINISHED` check would then reject the END_GAME action
 * THAT SAME TIMER dispatched, one line later, on the exact deadline
 * it was scheduled for. The game still ends correctly either way (the
 * self-heal and the ordinary END_GAME transition produce the same
 * result), but the timer's own caller only broadcasts `if (result.ok)`
 * — so every connected client would silently miss the real-time
 * broadcast and only find out on their next unrelated poll/reconnect,
 * defeating the entire point of a real-time timer. Confirmed via a real
 * countdown end-to-end, not reasoned about: the timer fired, called
 * this function, and got back `GAME_ALREADY_FINISHED` even though
 * nothing else had touched the game. `findLatestGameRow` — a plain
 * read, no side effects — is what a REAL action dispatch needs; only
 * pure READ paths (`sendCurrentSnapshot`/`session.getState`, this
 * file's own `getCurrentGame`) should ever self-heal.
 */
export async function applyGameAction(sessionId: string, rawAction: unknown): Promise<GameActionResult> {
  for (let attempt = 0; attempt < MAX_APPLY_ATTEMPTS; attempt++) {
    const game = await findLatestGameRow(sessionId);
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
