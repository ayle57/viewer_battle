"use client";

import { create } from "zustand";

export interface DrawingStroke {
  points: { x: number; y: number }[];
  color: string;
  width: number;
}

interface DrawingStoreState {
  /** The live canvas buffer for the CURRENT turn, exactly as the ephemeral drawing channel (src/server/sockets/drawing.ts) has delivered it to THIS client — never persisted, never part of `gameStore`'s own `gameState` (that store mirrors the Game Kernel's `game:state`; this one mirrors the separate, non-kernel `drawing:*` events — see that file's own top comment on why the two are deliberately split). */
  strokes: DrawingStroke[];
  /** The secret word, but ONLY ever populated for a socket that's genuinely the current drawer — see useGameSocket.ts's `requestPrompt` and drawing.ts's own doc comment on why this can't ride the ordinary `game:state` broadcast. `null` for every other role/player, and reset the moment a new turn starts (see `reset` below). */
  promptText: string | null;
  setSnapshot: (strokes: DrawingStroke[]) => void;
  addStroke: (stroke: DrawingStroke) => void;
  clear: () => void;
  /** Drops the single most recent stroke — the real "undo last stroke," see src/server/sockets/drawing.ts's own `drawing:undo` doc comment for the server half. A no-op on an already-empty buffer (a stale/duplicate broadcast should never throw). */
  undoLast: () => void;
  setPromptText: (text: string | null) => void;
  reset: () => void;
}

const initialDrawingStoreState = {
  strokes: [] as DrawingStroke[],
  promptText: null as string | null,
};

function createDrawingStore() {
  return create<DrawingStoreState>((set) => ({
    ...initialDrawingStoreState,
    setSnapshot: (strokes) => set({ strokes }),
    addStroke: (stroke) => set((state) => ({ strokes: [...state.strokes, stroke] })),
    clear: () => set({ strokes: [] }),
    undoLast: () => set((state) => ({ strokes: state.strokes.slice(0, -1) })),
    setPromptText: (text) => set({ promptText: text }),
    reset: () => set({ ...initialDrawingStoreState }),
  }));
}

/**
 * Pinned to `globalThis`, same reasoning (and same real bug it avoids) as
 * gameStore.ts's own `viewerBattleGameStore` — Next's Fast Refresh can
 * re-execute this module without unmounting the tree; the live socket
 * listeners in useGameSocket.ts are sitting in a `useEffect` that won't
 * re-run, so they'd keep writing into a stale, orphaned store unless this
 * one object survives across re-executions.
 */
const globalForDrawingStore = globalThis as unknown as { viewerBattleDrawingStore?: ReturnType<typeof createDrawingStore> };
export const useDrawingStore = globalForDrawingStore.viewerBattleDrawingStore ?? (globalForDrawingStore.viewerBattleDrawingStore = createDrawingStore());
