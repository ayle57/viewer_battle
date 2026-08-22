import styles from "./MatchScore.module.css";

export interface MatchScoreProps {
  teamA: number;
  teamB: number;
  /** "lg" is the Display's broadcast-scale treatment. */
  size?: "md" | "lg";
}

/**
 * "1 point per game won" — the session-wide tally across EVERY game this
 * session has run (see `SessionState.matchScore`, computed in
 * src/server/db/session.ts via each finished game's engine.getWinner()),
 * distinct from any single game's own 0-0-per-game in-game score. Counts
 * every finished game unconditionally — no fixed lineup, no cap, no
 * "replay doesn't count": a Host free to play the same mini-game 45
 * times in a row gets 45 real results, not one. Purely presentational —
 * the caller decides whether/when to show it (every screen that renders
 * this gates it on `teamA + teamB > 0`, so it never appears before
 * there's an actual match history to show).
 */
export function MatchScore({ teamA, teamB, size = "md" }: MatchScoreProps) {
  return (
    <div className={[styles.wrap, size === "lg" && styles.lg].filter(Boolean).join(" ")} role="status">
      <span className={styles.label}>Match</span>
      <span className={styles.teamA}>{teamA}</span>
      <span className={styles.divider}>—</span>
      <span className={styles.teamB}>{teamB}</span>
    </div>
  );
}
