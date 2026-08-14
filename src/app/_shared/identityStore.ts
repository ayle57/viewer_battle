"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { ParticipantRole } from "@/domain/session";

export interface Identity {
  sessionCode: string;
  role: ParticipantRole;
  displayName: string;
  /** Real bearer token from session.join (src/server/auth/token.ts) — same scheme for all 4 roles, the one identity system this app has. */
  token: string;
}

interface IdentityState {
  identity: Identity | null;
  setIdentity: (identity: Identity) => void;
  clearIdentity: () => void;
}

/**
 * The product routes' own identity — /host, /player, /display. Same
 * token scheme as src/app/dev/_shared/devIdentityStore.ts (there is only
 * ever one auth system: an opaque bearer token resolved through
 * src/server/auth), deliberately a SEPARATE store/storage key so a dev
 * tab testing as some role never collides with (or gets mistaken for) a
 * real product tab. This is the "clean, isolated entry point" the Host
 * connexion flow needs — a real account system later only has to replace
 * how THIS store gets populated (the login screen), not anything that
 * reads from it.
 *
 * sessionStorage, not localStorage: a host reloading /host should resume
 * their session (that's "Host reconnected"), but a second tab must be
 * able to become a different participant — the same reasoning
 * devIdentityStore documents for the dev playground applies verbatim
 * here, just for real usage instead of testing.
 */
function createIdentityStore() {
  return create<IdentityState>()(
    persist(
      (set) => ({
        identity: null,
        setIdentity: (identity) => set({ identity }),
        clearIdentity: () => set({ identity: null }),
      }),
      {
        name: "viewerbattle-identity",
        storage: createJSONStorage(() => sessionStorage),
      },
    ),
  );
}

// Pinned to globalThis — same reason as every other store in this app
// (see gameStore.ts's comment on useGameStore): Fast Refresh must not
// hand out a second store while a live socket keeps writing to the old one.
const globalForIdentityStore = globalThis as unknown as { viewerBattleIdentityStore?: ReturnType<typeof createIdentityStore> };
export const useIdentityStore =
  globalForIdentityStore.viewerBattleIdentityStore ?? (globalForIdentityStore.viewerBattleIdentityStore = createIdentityStore());
