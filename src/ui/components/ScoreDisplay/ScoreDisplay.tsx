import styles from "./ScoreDisplay.module.css";

export interface ScoreDisplayProps {
  teamAName: string;
  teamAScore: number;
  teamBName: string;
  teamBScore: number;
  label?: string;
  /** "md" (default) fits a header/card context (Host/Player). "lg" is the OBS-scale hero treatment Display needs — same layout, much bigger type, not a second component. */
  size?: "md" | "lg";
}

export function ScoreDisplay({ teamAName, teamAScore, teamBName, teamBScore, label, size = "md" }: ScoreDisplayProps) {
  return (
    <div className={[styles.row, size === "lg" && styles.lg].filter(Boolean).join(" ")}>
      {label && <p className={styles.label}>{label}</p>}
      <div className={styles.side}>
        <span className={styles.name}>{teamAName}</span>
        <span className={[styles.score, styles.scoreA].join(" ")}>{teamAScore}</span>
      </div>
      <span className={styles.vs}>VS</span>
      <div className={[styles.side, styles.sideB].join(" ")}>
        <span className={styles.name}>{teamBName}</span>
        <span className={[styles.score, styles.scoreB].join(" ")}>{teamBScore}</span>
      </div>
    </div>
  );
}
