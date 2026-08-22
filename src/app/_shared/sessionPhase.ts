import type { SessionStatus } from "@/domain/session";
import type { GameStatus } from "@/domain/game";

/**
 * A ViewerBattle session outlives any one game — see AGENTS.md "Session
 * vs. Game phases". `SessionPhase` is the app-facing screen a client
 * should show right now, but it's NOT a second state machine: it's
 * derived, fresh, on every render, from exactly the three real signals
 * that already exist server-side —
 *
 *   1. Session.status         (src/domain/session/status.ts)
 *   2. whether a game exists  (gameStore.gameId — null until the first
 *                               SessionGame is ever created for this
 *                               session, never cleared afterward: "the
 *                               current game" is always the most
 *                               recently started one)
 *   3. that game's own status (gameStore.gameState.status — GameStatus,
 *                               "in_progress" | "finished"; every engine
 *                               exposes this by the Game Kernel contract,
 *                               so this reads generically, not anything
 *                               Jeopardy-specific)
 *
 * There is deliberately no separate boolean anywhere (`isGameOver`,
 * `hasReturnedToLobby`, ...) that could drift from these — every
 * Host/Player/Display screen calls this same function with whatever the
 * store/query currently hold, so a stale local flag is structurally not
 * possible: there's nothing to go stale, the phase is recomputed from the
 * live inputs every time.
 */
export type SessionPhase = "SESSION_LOBBY" | "GAME_IN_PROGRESS" | "GAME_FINISHED" | "SESSION_FINISHED";

export interface SessionPhaseInput {
  /** From trpc.session.getState (polled — see the product pages), undefined while that query hasn't resolved yet. */
  sessionStatus: SessionStatus | undefined;
  /** From useGameStore — null until a game has ever been started for this session. */
  gameId: string | null;
  /** From useGameStore's gameState.status — read generically (see the file doc comment), null until a game exists or before its first snapshot arrives. */
  gameStatus: GameStatus | null;
  /**
   * True once THIS tab has heard, in real time, that the session just
   * ended — the `session:ended` socket push (gameStore.ts's
   * `sessionEnded`, set the instant this tab's socket hears it), fired
   * the moment `session.finish` runs, before `sessionStatus` itself even
   * flips to "FINISHED" server-side. A currently-connected tab gets the
   * instant version through this flag instead of waiting up to one
   * polling interval for `session.getState` to report `status:
   * "FINISHED"` on its own — which it always eventually will regardless
   * (ending a session is a soft update, not a delete — see `endSession`
   * in src/server/db/session.ts), so this is a latency shortcut, not the
   * only path to this phase. Optional, not a required third leg of the
   * derivation the way `sessionStatus`/`gameId`/`gameStatus` are — most
   * callsites (tests, anything not driven by a real socket) simply never
   * have this signal and that's fine, it defaults to "no," and
   * `sessionStatus === "FINISHED"` alone still gets them here.
   */
  sessionEnded?: boolean;
}

export function deriveSessionPhase({ sessionStatus, gameId, gameStatus, sessionEnded }: SessionPhaseInput): SessionPhase {
  // Wins over everything else: an ended/finished session is a dead end
  // regardless of whatever the last game snapshot happened to say.
  if (sessionEnded || sessionStatus === "FINISHED") return "SESSION_FINISHED";
  if (!gameId) return "SESSION_LOBBY";
  return gameStatus === "finished" ? "GAME_FINISHED" : "GAME_IN_PROGRESS";
}

/** Reads `GameStatus` off an opaque game snapshot the same generic way every engine exposes it (Game Kernel contract) — never Jeopardy-specific. */
export function readGameStatus(gameState: Record<string, unknown> | null): GameStatus | null {
  if (!gameState) return null;
  const status = gameState.status;
  return status === "in_progress" || status === "finished" ? status : null;
}
