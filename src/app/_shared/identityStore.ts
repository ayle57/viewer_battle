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
  /**
   * A REAL, REPRODUCED bug this closes: Host rotating the session code
   * (self-service, or automatically as part of a kick) only ever changed
   * `Session.code` server-side — every OTHER already-connected client
   * (both teams, Display, any other Host tab) kept polling
   * `session.getState` with the STALE code it captured at join time,
   * which started 404ing (`SESSION_NOT_FOUND`) forever, misread as the
   * whole session having ended (sessionPhase.ts) even though it was
   * completely alive. `useGameSocket.ts` listens for the new
   * `session:code-rotated` broadcast (server/sockets/session.ts) and
   * calls this — the ONE place `identity.sessionCode` gets corrected in
   * place, everything downstream (this route's own `session.getState`
   * query, the code shown in the header) just starts using the fresh
   * value on its next read, with no special-casing anywhere else.
   */
  updateSessionCode: (sessionCode: string) => void;
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
        // A no-op if identity is already gone (e.g. the broadcast lands
        // in the brief window after this tab already cleared its own
        // identity) — nothing to correct for an identity that no longer
        // exists.
        updateSessionCode: (sessionCode) =>
          set((state) => (state.identity ? { identity: { ...state.identity, sessionCode } } : state)),
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
