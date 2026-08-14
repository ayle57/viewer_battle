import styles from "./PlayerCard.module.css";

export interface PlayerCardData {
  name: string;
  connected?: boolean;
  detail?: string;
}

export function PlayerCard({ name, connected = true, detail }: PlayerCardData) {
  const initials = name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className={[styles.row, !connected && styles.disconnected].filter(Boolean).join(" ")}>
      <span className={styles.avatar} aria-hidden="true">
        {initials}
      </span>
      <span className={styles.identity}>
        <span className={styles.name}>{name}</span>
        {detail && <span className={styles.detail}>{detail}</span>}
      </span>
      <span
        className={[styles.statusDot, connected ? styles.online : styles.offline].join(" ")}
        title={connected ? "Connected" : "Disconnected"}
      />
    </div>
  );
}
