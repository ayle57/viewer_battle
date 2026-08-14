"use client";

import styles from "./HostDisconnectedBanner.module.css";

/**
 * "HOST DISCONNECTED — waiting for host to reconnect", shown ON TOP of
 * whatever the player/display screen is already displaying — never in
 * place of it. Real game state (score, active question, phase) stays
 * exactly as it was; a host dropping is a connectivity blip, not a
 * reason to wipe anything. Disappears the instant presence:update says
 * a HOST is connected again (see usePresenceStore) — there's no local
 * "reconnecting" timer or guesswork, this reflects the server's own
 * live fact.
 */
export function HostDisconnectedBanner() {
  return (
    <div className={styles.banner} role="status">
      <p className={styles.title}>HOST DISCONNECTED</p>
      <p className={styles.subtitle}>Waiting for host to reconnect…</p>
    </div>
  );
}
