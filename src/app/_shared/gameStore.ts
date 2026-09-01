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
   * fired by the host's own "End session" the moment it runs, ahead of
   * the `status: "FINISHED"` update actually landing
   * (src/server/db/session.ts's `endSession`). Every product page treats
   * this as an override on top of `deriveSessionPhase` (sessionPhase.ts):
   * once true, it's the terminal SESSION_FINISHED screen right away,
   * instead of waiting on this tab's next `session.getState` poll to
   * observe the same status flip on its own. Stays true for as long as
   * THIS identity/token is connected — see `reset()` below for the one
   * moment it actually needs to clear.
   */
  sessionEnded: boolean;
  /**
   * True once THIS tab's own socket receives `participant:kicked`
   * (src/server/sockets/session.ts's broadcastParticipantKicked) — the
   * Host forcibly freed this seat. Distinct from `sessionEnded`: the
   * session itself is still very much alive for everyone else, only
   * THIS participant's token just stopped working. Same reset contract
   * as `sessionEnded` — see `reset()` below.
   */
  kicked: boolean;
  /**
   * True once THIS connection's initial catch-up snapshot attempt has
   * genuinely completed (`game:synced`, src/server/sockets/game.ts) — NOT
   * the same moment as `status === "connected"`. That's a real, reported
   * bug this closes: a fresh mount/reload's very FIRST render always has
   * `gameId: null` (nothing has arrived yet), which reads exactly like
   * "no game running" even mid-game, and the DB read behind the real
   * catch-up snapshot is a genuine async gap AFTER the socket transport
   * itself connects. Any code deciding "did the game juuust start" (the
   * READY->3->2->1->LIVE sequence — player/page.tsx, display/page.tsx)
   * needs this, not `status`, to tell "still loading" apart from
   * "confirmed: no game." Reset alongside everything else in `reset()`
   * below.
   */
  synced: boolean;
  setSnapshot: (snapshot: { gameId: string; gameKey: string; state: Record<string, unknown>; events: unknown[] }) => void;
  setStatus: (status: GameConnectionStatus) => void;
  setError: (error: GameError | null) => void;
  setSessionEnded: () => void;
  setKicked: () => void;
  setSynced: () => void;
  /**
   * Back to every field's true initial value — called once by
   * useGameSocket.ts at the START of its connection effect, whenever
   * `token` actually changes to a new, real value. `sessionEnded`/
   * `kicked` were originally documented as "never reset — a genuinely
   * new session means a fresh page/token/store anyway," which held back
   * when the only way to start a new session was a full page reload. It
   * stopped holding the moment this store was pinned to `globalThis`
   * (this file's own doc comment, for an unrelated Fast Refresh bug):
   * clicking "Start a new game" after a session ends (Host/Player/
   * Display's own SESSION_FINISHED screens) is now a PURE client-side
   * identity swap — clearIdentity() then a fresh setIdentity() — with no
   * reload at all, so this store's stale `sessionEnded: true` from the
   * OLD, actually-ended session silently carried over and permanently
   * pinned the BRAND NEW session's own phase to SESSION_FINISHED too,
   * even though it had barely started (confirmed: "Start a new game"
   * kept landing right back on "Session ended"). This is the actual
   * connection-lifecycle boundary that should have reset it all along.
   */
  reset: () => void;
}

const initialGameStoreState = {
  gameId: null as string | null,
  gameKey: null as string | null,
  gameState: null as Record<string, unknown> | null,
  status: "connecting" as GameConnectionStatus,
  lastEvents: [] as unknown[],
  lastError: null as GameError | null,
  sessionEnded: false,
  kicked: false,
  synced: false,
};

function createGameStore() {
  return create<GameStoreState>((set) => ({
    ...initialGameStoreState,
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
    setKicked: () => set({ kicked: true }),
    setSynced: () => set({ synced: true }),
    reset: () => set({ ...initialGameStoreState }),
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
