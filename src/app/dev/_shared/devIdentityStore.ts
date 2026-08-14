"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { ParticipantRole } from "@/domain/session";

export interface DevIdentity {
  sessionCode: string;
  role: ParticipantRole;
  displayName: string;
  /** Real bearer token from session.join — see src/server/auth/token.ts. */
  token: string;
}

interface DevIdentityState {
  identity: DevIdentity | null;
  setIdentity: (identity: DevIdentity) => void;
  clearIdentity: () => void;
}

/**
 * Which test identity this BROWSER TAB is currently using across the dev
 * playground (/dev/session, /dev/chat, /dev/host, /dev/player,
 * /dev/display, ...).
 *
 * Backed by sessionStorage, not localStorage, on purpose: the whole point
 * of the playground is running several tabs side by side as different
 * roles at once (Host in one tab, Team A in another, Display in a
 * third...). localStorage is shared across every tab of the same origin
 * and would collapse them all onto a single identity; sessionStorage is
 * per-tab, so each tab keeps its own.
 *
 * The `token` here is a REAL bearer token issued by `session.join` (tRPC)
 * — this is genuine session state, not a trusted client-side claim
 * anymore. It's still dev-tooling storage though (sessionStorage, no
 * httpOnly cookie, no CSRF story) — production Host/Player/Display auth
 * will carry the token differently, but resolve identity through the
 * exact same src/server/auth seam.
 */
export const useDevIdentityStore = create<DevIdentityState>()(
  persist(
    (set) => ({
      identity: null,
      setIdentity: (identity) => set({ identity }),
      clearIdentity: () => set({ identity: null }),
    }),
    {
      name: "viewerbattle-dev-identity",
      storage: createJSONStorage(() => sessionStorage),
    },
  ),
);
