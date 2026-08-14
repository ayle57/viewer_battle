import styles from "./PresenceDot.module.css";

export interface PresenceDotProps {
  connected: boolean;
  /** Defaults to "Connected"/"Offline" — override for a role-specific phrasing (e.g. "Display connected"). */
  label?: string;
}

/**
 * A live "who's actually here right now" indicator — ● Connected / ○
 * Offline — reused everywhere a roster is shown (session lobby, host
 * sidebar, player's team/opponent panel, the pre-game display screen).
 * Purely presentational: whoever renders this already resolved
 * `connected` from real presence data (src/server/sockets/presence.ts
 * via usePresenceStore), never guesses it.
 */
export function PresenceDot({ connected, label }: PresenceDotProps) {
  const text = label ?? (connected ? "Connected" : "Offline");
  return (
    <span className={[styles.wrap, connected ? styles.connected : styles.offline].join(" ")}>
      <span className={styles.dot} aria-hidden="true" />
      {text}
    </span>
  );
}
