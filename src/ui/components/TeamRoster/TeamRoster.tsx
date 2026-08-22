import { getInitials } from "../../initials";
import { PresenceDot } from "../PresenceDot/PresenceDot";
import styles from "./TeamRoster.module.css";

export interface TeamRosterSeat {
  id: string;
  displayName: string;
  connected: boolean;
}

export interface TeamRosterProps {
  teamName: string;
  variant: "teamA" | "teamB";
  /** Up to `seatCount` players; missing seats render as "empty". */
  seats: TeamRosterSeat[];
  seatCount?: number;
  /** Highlights this seat (e.g. "you") — matched by id. */
  highlightId?: string;
  /**
   * Host-only — present -> every occupied seat gets a small remove
   * button. Optional and otherwise absent on purpose: this exact same
   * component/list is reused for a Player's own read-only view of their
   * team/opponents and the OBS Display screen (see this component's own
   * doc comment below), neither of which should ever grow a kick
   * button — only the Host's usage (host/page.tsx) passes this.
   */
  onKick?: (seatId: string, displayName: string) => void;
  /** The seat currently being kicked (a mutation in flight) — disables its own button and shows a loading state, without touching the OTHER seats. */
  kickingId?: string | null;
}

/**
 * A team's roster — name + each seat's player and live presence, or
 * "empty" if unclaimed. Reused across the session lobby, the host's
 * sidebar, a player's own team/opponent panel, and the pre-game display
 * screen — the one place this shape is drawn, instead of four slightly
 * different copies.
 */
export function TeamRoster({ teamName, variant, seats, seatCount = 2, highlightId, onKick, kickingId }: TeamRosterProps) {
  const slots = Array.from({ length: seatCount }, (_, i) => seats[i] ?? null);

  return (
    <div className={[styles.wrap, styles[variant]].join(" ")}>
      <p className={styles.teamName}>{teamName}</p>
      <ul className={styles.seatList}>
        {slots.map((seat, i) => (
          <li key={seat?.id ?? `empty-${i}`} className={styles.seat}>
            {seat ? (
              <>
                <span className={styles.seatAvatar} aria-hidden="true">
                  {getInitials(seat.displayName)}
                </span>
                <span className={[styles.seatName, seat.id === highlightId && styles.you].filter(Boolean).join(" ")}>
                  {seat.displayName}
                  {seat.id === highlightId ? " (you)" : ""}
                </span>
                <span className={styles.seatEnd}>
                  <PresenceDot connected={seat.connected} />
                  {onKick && (
                    <button
                      type="button"
                      className={styles.kickButton}
                      disabled={kickingId === seat.id}
                      onClick={() => onKick(seat.id, seat.displayName)}
                      aria-label={`Disconnect ${seat.displayName}`}
                      title={`Disconnect ${seat.displayName}`}
                    >
                      {kickingId === seat.id ? "…" : "✕"}
                    </button>
                  )}
                </span>
              </>
            ) : (
              <span className={styles.empty}>Empty seat</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
