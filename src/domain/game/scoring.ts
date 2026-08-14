import { TEAM_ROLES, type TeamRole } from "@/domain/session";

/** Shared shape for the common case (2 teams, numeric score) — not every engine has to use this if its scoring doesn't fit, but most of the manual-score/board games do. */
export type Scoreboard = Record<TeamRole, number>;

export function initialScoreboard(): Scoreboard {
  return { TEAM_A: 0, TEAM_B: 0 };
}

/** Pure — returns a new Scoreboard, never mutates the input. */
export function addScore(scoreboard: Scoreboard, team: TeamRole, delta: number): Scoreboard {
  return { ...scoreboard, [team]: scoreboard[team] + delta };
}

/**
 * Teams currently at or above `threshold`, highest score first. An engine
 * checks this immediately after applying a score change within a single
 * `apply()` call — since apply() only ever processes one action at a
 * time, "first to N" falls out naturally from "did THIS update cross the
 * line", with no separate race/ordering logic needed.
 */
export function checkFirstToN(scoreboard: Scoreboard, threshold: number): TeamRole[] {
  return TEAM_ROLES.filter((team) => scoreboard[team] >= threshold).sort((a, b) => scoreboard[b] - scoreboard[a]);
}

/** The leader, or null if tied (including 0-0). Doesn't declare a winner on its own — an engine decides whether a tie ends the game or continues it. */
export function leadingTeam(scoreboard: Scoreboard): TeamRole | null {
  const [a, b] = TEAM_ROLES;
  if (scoreboard[a] === scoreboard[b]) return null;
  return scoreboard[a] > scoreboard[b] ? a : b;
}
