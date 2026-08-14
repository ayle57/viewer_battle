import { Badge } from "../../primitives/Badge/Badge";
import { PlayerCard, type PlayerCardData } from "../PlayerCard/PlayerCard";
import styles from "./TeamCard.module.css";

export type TeamSide = "A" | "B";

export interface TeamCardProps {
  side: TeamSide;
  name: string;
  score: number;
  players: PlayerCardData[];
  subtitle?: string;
}

export function TeamCard({ side, name, score, players, subtitle }: TeamCardProps) {
  return (
    <div className={[styles.card, side === "A" ? styles.teamA : styles.teamB].join(" ")}>
      <div className={styles.headerRow}>
        <div>
          <div className={styles.badges}>
            <Badge variant={side === "A" ? "teamA" : "teamB"}>Team {side}</Badge>
            <Badge variant="neutral" size="sm">
              {players.length} player{players.length === 1 ? "" : "s"}
            </Badge>
          </div>
          <h3 className={styles.name}>{name}</h3>
          {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
        </div>
        <span className={styles.score}>{score}</span>
      </div>
      <div className={styles.players}>
        {players.length === 0 ? <p className={styles.empty}>No players connected yet.</p> : null}
        {players.map((player) => <PlayerCard key={player.name} {...player} />)}
      </div>
    </div>
  );
}
