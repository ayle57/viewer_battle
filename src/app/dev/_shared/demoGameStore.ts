"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export interface DemoParticipant {
  token: string;
  displayName: string;
}

export interface DemoGame {
  sessionCode: string;
  host: DemoParticipant;
  teamA: [DemoParticipant, DemoParticipant];
  teamB: [DemoParticipant, DemoParticipant];
  display: DemoParticipant;
}

interface DemoGameState {
  demo: DemoGame | null;
  setDemo: (demo: DemoGame) => void;
  clearDemo: () => void;
}

/**
 * The "Quick Demo" game this whole browser has going, if any — deliberately
 * `localStorage`, not `sessionStorage`: this needs to survive closing and
 * reopening a tab, and be visible to a brand new tab (that's the point —
 * one Create, then several tabs opened from the same record). Contrast
 * with devIdentityStore (sessionStorage, per-tab), which is "who THIS tab
 * currently is," a separate concern from "what demo game exists at all."
 *
 * Real tokens live here (from real session.join calls) — this is
 * convenience storage for the dev playground, not a second identity
 * system; resolving who someone is still only ever happens through
 * src/server/auth, same as everywhere else.
 */
const STORAGE_KEY = "viewerbattle-demo-game";

function createDemoGameStore() {
  return create<DemoGameState>()(
    persist(
      (set) => ({
        demo: null,
        setDemo: (demo) => set({ demo }),
        clearDemo: () => set({ demo: null }),
      }),
      {
        name: STORAGE_KEY,
        storage: createJSONStorage(() => localStorage),
      },
    ),
  );
}

// Pinned to globalThis for the same reason as gameStore.ts's
// useGameStore and devIdentityStore.ts's useDevIdentityStore — a Fast
// Refresh re-execution of this module must not hand out a second store.
const globalForDemoGameStore = globalThis as unknown as { viewerBattleDemoGameStore?: ReturnType<typeof createDemoGameStore> };
export const useDemoGameStore =
  globalForDemoGameStore.viewerBattleDemoGameStore ?? (globalForDemoGameStore.viewerBattleDemoGameStore = createDemoGameStore());

// zustand's `persist` only writes to localStorage — it doesn't listen for
// changes made elsewhere. Without this, a Reset (or a new Create) done in
// one tab is invisible to every other tab already open: they keep holding
// their in-memory `demo` with its now-dead host token, so their next
// action against it repeats the exact "resolve a stale token → SESSION_
// CLOSED / INVALID_TOKEN" failure this store exists to avoid. The
// `storage` event fires on every other same-origin tab whenever localStorage
// changes (never on the tab that made the change), which is exactly the
// signal needed to re-sync.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY) {
      void useDemoGameStore.persist.rehydrate();
    }
  });
}
