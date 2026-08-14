import styles from "./ScoreDisplay.module.css";

export interface ScoreDisplayProps {
  teamAName: string;
  teamAScore: number;
  teamBName: string;
  teamBScore: number;
  label?: string;
}

export function ScoreDisplay({ teamAName, teamAScore, teamBName, teamBScore, label }: ScoreDisplayProps) {
  return (
    <div className={styles.row}>
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
