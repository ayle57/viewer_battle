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
}

/**
 * A team's roster — name + each seat's player and live presence, or
 * "empty" if unclaimed. Reused across the session lobby, the host's
 * sidebar, a player's own team/opponent panel, and the pre-game display
 * screen — the one place this shape is drawn, instead of four slightly
 * different copies.
 */
export function TeamRoster({ teamName, variant, seats, seatCount = 2, highlightId }: TeamRosterProps) {
  const slots = Array.from({ length: seatCount }, (_, i) => seats[i] ?? null);

  return (
    <div className={[styles.wrap, styles[variant]].join(" ")}>
      <p className={styles.teamName}>{teamName}</p>
      <ul className={styles.seatList}>
        {slots.map((seat, i) => (
          <li key={seat?.id ?? `empty-${i}`} className={styles.seat}>
            {seat ? (
              <>
                <span className={[styles.seatName, seat.id === highlightId && styles.you].filter(Boolean).join(" ")}>
                  {seat.displayName}
                  {seat.id === highlightId ? " (you)" : ""}
                </span>
                <PresenceDot connected={seat.connected} />
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
