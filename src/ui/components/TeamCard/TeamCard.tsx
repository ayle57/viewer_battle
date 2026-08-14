import { Badge } from "../../primitives/Badge/Badge";
import { PlayerCard, type PlayerCardData } from "../PlayerCard/PlayerCard";
import styles from "./TeamCard.module.css";

export type TeamSide = "A" | "B";

export interface TeamCardProps {
  side: TeamSide;
  name: string;
  score: number;
  players: PlayerCardData[];
}

export function TeamCard({ side, name, score, players }: TeamCardProps) {
  return (
    <div className={[styles.card, side === "A" ? styles.teamA : styles.teamB].join(" ")}>
      <div className={styles.headerRow}>
        <div>
          <Badge variant={side === "A" ? "teamA" : "teamB"}>Team {side}</Badge>
          <h3 className={styles.name}>{name}</h3>
        </div>
        <span className={styles.score}>{score}</span>
      </div>
      <div className={styles.players}>
        {players.map((player) => (
          <PlayerCard key={player.name} {...player} />
        ))}
      </div>
    </div>
  );
}
