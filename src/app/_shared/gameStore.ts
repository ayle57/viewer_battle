"use client";

import { create } from "zustand";

export type GameConnectionStatus = "connecting" | "connected" | "disconnected" | "unauthorized";

export interface GameError {
  code: string;
  message: string;
}

interface GameStoreState {
  gameId: string | null;
  gameKey: string | null;
  /** Opaque on purpose — the store doesn't know Jeopardy's shape, a component reading `gameState` narrows it per `gameKey`. No business logic lives here, just the last snapshot the server sent. */
  gameState: Record<string, unknown> | null;
  status: GameConnectionStatus;
  lastEvents: unknown[];
  lastError: GameError | null;
  /**
   * A real-time push, not a derived value — flips true the instant this
   * tab's socket receives `session:ended` (src/server/sockets/session.ts),
   * fired by the host's own "End session" ending the session for real
   * (a hard delete, not the old soft `status: FINISHED`). Every product
   * page treats this as an override on top of `deriveSessionPhase`
   * (sessionPhase.ts): once true, it's the terminal SESSION_FINISHED
   * screen regardless of what a stale/failing `session.getState` poll
   * says, because after a real delete there IS no `sessionStatus` left to
   * poll. Never reset back to false — a session that's gone stays gone
   * for this tab; a genuinely new session means a fresh page/token/store
   * anyway.
   */
  sessionEnded: boolean;
  setSnapshot: (snapshot: { gameId: string; gameKey: string; state: Record<string, unknown>; events: unknown[] }) => void;
  setStatus: (status: GameConnectionStatus) => void;
  setError: (error: GameError | null) => void;
  setSessionEnded: () => void;
}

function createGameStore() {
  return create<GameStoreState>((set) => ({
    gameId: null,
    gameKey: null,
    gameState: null,
    status: "connecting",
    lastEvents: [],
    lastError: null,
    sessionEnded: false,
    setSnapshot: (snapshot) =>
      set({
        gameId: snapshot.gameId,
        gameKey: snapshot.gameKey,
        gameState: snapshot.state,
        lastEvents: snapshot.events,
      }),
    setStatus: (status) => set({ status }),
    setError: (error) => set({ lastError: error }),
    setSessionEnded: () => set({ sessionEnded: true }),
  }));
}

/**
 * Client-side mirror of whatever `game:state` last told this tab —
 * "session/game identity, current GameState, connection status, errors,"
 * nothing else. Components read slices of this; only useGameSocket.ts
 * (the socket transport) ever calls the setters.
 *
 * Pinned to `globalThis`, same reasoning (and same fix) as
 * src/server/sockets/instance.ts's `ioInstance`: this was a REAL bug, not
 * theoretical. Next's Fast Refresh can re-execute this module (any edit
 * to this file, or to a file that imports it) without unmounting the
 * component tree — when that happens, a plain `create()` here hands out a
 * BRAND NEW store with fresh `null` defaults. The live socket in
 * useGameSocket.ts is sitting in a `useEffect` that never re-ran (its
 * `[token]` dependency didn't change), so it keeps calling the OLD
 * store's setters on every future `game:state` — while every component
 * re-render reads the NEW store via the freshly re-imported hook, which
 * nothing is writing to anymore. The board looks like it reset to "no
 * game running" and never recovers until a real page reload, even though
 * the socket is alive and the actual game is fine. Reusing the same store
 * object across module re-executions closes that gap entirely.
 */
const globalForGameStore = globalThis as unknown as { viewerBattleGameStore?: ReturnType<typeof createGameStore> };
export const useGameStore = globalForGameStore.viewerBattleGameStore ?? (globalForGameStore.viewerBattleGameStore = createGameStore());
