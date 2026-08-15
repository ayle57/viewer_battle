"use client";

import { Badge, type BadgeVariant } from "@/ui";

export type LobbyStatusValue = "waiting-for-host" | "ready" | "starting";

const LABEL: Record<LobbyStatusValue, string> = {
  "waiting-for-host": "Waiting for host",
  ready: "Ready",
  starting: "Game starting…",
};

const VARIANT: Record<LobbyStatusValue, BadgeVariant> = {
  "waiting-for-host": "warning",
  ready: "success",
  starting: "host",
};

/**
 * The Lobby's headline status line — three real, derived states, not a
 * fourth thing to keep in sync with `SessionPhase` (sessionPhase.ts):
 * this only ever renders while phase is SESSION_LOBBY or GAME_FINISHED
 * (both "in the Lobby"), computed from the same live presence signal
 * every screen already reads (`presence.some(p => p.role === "HOST")`)
 * plus whether `game.start`'s own mutation is in flight. No new
 * server-side concept, no polling of its own.
 */
export function LobbyStatus({ value }: { value: LobbyStatusValue }) {
  return (
    <Badge variant={VARIANT[value]} dot>
      {LABEL[value]}
    </Badge>
  );
}
