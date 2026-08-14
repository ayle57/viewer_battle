"use client";

import { create } from "zustand";

export interface PresenceParticipant {
  participantId: string;
  role: "HOST" | "TEAM_A" | "TEAM_B" | "DISPLAY";
  displayName: string;
}

interface PresenceState {
  participants: PresenceParticipant[];
  setParticipants: (participants: PresenceParticipant[]) => void;
}

function createPresenceStore() {
  return create<PresenceState>((set) => ({
    participants: [],
    setParticipants: (participants) => set({ participants }),
  }));
}

/**
 * Who's actually connected to the current session right now, as reported
 * by the server (src/server/sockets/presence.ts) — not derived, not
 * guessed from local state. Same globalThis-pinning as gameStore.ts's
 * useGameStore, for the same reason (Fast Refresh must not split this
 * store from the live socket writing to it).
 */
const globalForPresenceStore = globalThis as unknown as { viewerBattlePresenceStore?: ReturnType<typeof createPresenceStore> };
export const usePresenceStore =
  globalForPresenceStore.viewerBattlePresenceStore ?? (globalForPresenceStore.viewerBattlePresenceStore = createPresenceStore());
