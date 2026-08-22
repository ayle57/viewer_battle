/**
 * Turns the last broadcast `events` array into a one-line result the
 * player/display screens can show right after a question closes — reads
 * only what the server already sent (see AGENTS.md "no fake data"), never
 * invents anything. Board-question-specific shape, so it lives next to
 * the rest of this game's view code, not in src/ui.
 */
// A REAL, REPRODUCED bug this closes: `event.team` is the server's own
// raw enum value ("TEAM_A"/"TEAM_B"), never meant for display — every
// OTHER team-facing label in this app reads "Team A"/"Team B". Confirmed
// directly, Player screen: judging an answer correct showed "TEAM_A got
// it — +100," a technical string leaking straight onto a player-facing
// screen. Falls back to the raw value for any future team-shaped role
// this map doesn't know about, rather than showing nothing.
const TEAM_DISPLAY_LABEL: Record<string, string> = { TEAM_A: "Team A", TEAM_B: "Team B" };

export function describeLastResult(events: unknown[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i] as { type?: string; team?: string; correct?: boolean; pointsAwarded?: number };
    if (event.type === "ANSWER_JUDGED") {
      const team = TEAM_DISPLAY_LABEL[event.team ?? ""] ?? event.team;
      return event.correct ? `${team} got it — +${event.pointsAwarded}` : `${team} got it wrong.`;
    }
    if (event.type === "QUESTION_CLOSED") {
      return "Question closed — nobody got it.";
    }
    if (event.type === "GAME_FINISHED") {
      return null; // the board's own "finished" state already covers this
    }
  }
  return null;
}

/** The most recent ANSWER_JUDGED event, if the last thing that happened was a judgment — used for a big CORRECT/INCORRECT beat on the player/display screens, straight from what the server actually judged. */
export function lastJudgment(events: unknown[]): { team: string; correct: boolean } | null {
  const last = events[events.length - 1] as { type?: string; team?: string; correct?: boolean } | undefined;
  if (last?.type !== "ANSWER_JUDGED") return null;
  return { team: last.team ?? "", correct: Boolean(last.correct) };
}
