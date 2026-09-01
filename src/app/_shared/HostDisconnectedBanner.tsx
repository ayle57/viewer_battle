"use client";

import { StatusBanner } from "./StatusBanner";

/**
 * "HOST DISCONNECTED — waiting for host to reconnect", shown ON TOP of
 * whatever the player/display screen is already displaying — never in
 * place of it. Real game state (score, active question, phase) stays
 * exactly as it was; a host dropping is a connectivity blip, not a
 * reason to wipe anything. Disappears the instant presence:update says
 * a HOST is connected again (see usePresenceStore) — there's no local
 * "reconnecting" timer or guesswork, this reflects the server's own
 * live fact.
 *
 * A thin wrapper over `StatusBanner` — the same visual language now also
 * used for THIS tab's own connection (player/page.tsx, display/page.tsx),
 * so "something about connectivity needs attention" reads identically
 * everywhere instead of two banners independently styled.
 */
export function HostDisconnectedBanner() {
  return <StatusBanner title="HOST DISCONNECTED" subtitle="Waiting for host to reconnect…" />;
}
