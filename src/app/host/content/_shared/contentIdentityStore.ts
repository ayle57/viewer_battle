"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

interface ContentIdentityState {
  token: string | null;
  setToken: (token: string) => void;
  clearToken: () => void;
}

/**
 * Content Studio's own identity store — deliberately separate from
 * src/app/_shared/identityStore.ts (Session Participant identity).
 *
 * localStorage, not sessionStorage: a live game identity is meant to be
 * scoped to one tab/session (see identityStore.ts's own reasoning), but a
 * content-prep workspace is the opposite — a Host should be able to close
 * the browser, come back tomorrow, and still see the playlists they were
 * building. Same bearer-token scheme as everywhere else in this app
 * (src/server/auth/token.ts via src/server/db/contentHost.ts) — losing
 * this token loses access to that identity's playlists, the same honest
 * tradeoff every other identity in this app makes.
 *
 * Pinned to globalThis for the same reason as every other store in this
 * app (see gameStore.ts/identityStore.ts) — Fast Refresh must not hand a
 * component a second, empty store while another part of the tree still
 * reads the old one.
 */
function createContentIdentityStore() {
  return create<ContentIdentityState>()(
    persist(
      (set) => ({
        token: null,
        setToken: (token) => set({ token }),
        clearToken: () => set({ token: null }),
      }),
      {
        name: "viewerbattle-content-identity",
        storage: createJSONStorage(() => localStorage),
      },
    ),
  );
}

const globalForContentIdentity = globalThis as unknown as { viewerBattleContentIdentityStore?: ReturnType<typeof createContentIdentityStore> };
export const useContentIdentityStore =
  globalForContentIdentity.viewerBattleContentIdentityStore ??
  (globalForContentIdentity.viewerBattleContentIdentityStore = createContentIdentityStore());
