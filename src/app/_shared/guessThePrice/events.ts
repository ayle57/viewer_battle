/**
 * Turns the last broadcast `events` array into a one-line result the
 * player/display screens can show right after a round closes — reads
 * only what the server already sent, never invents anything. Guess the
 * Price-specific shape (no `pointsAwarded` — every correct round is
 * worth exactly 1 point, see src/domain/game/guessThePrice/types.ts's
 * top comment; `ROUND_CLOSED`, same event name as SteamRatingsEngine's
 * own), so this lives next to the rest of this game's view code rather
 * than reusing boardQuestion/events.ts's own describeLastResult.
 */
const TEAM_DISPLAY_LABEL: Record<string, string> = { TEAM_A: "Team A", TEAM_B: "Team B" };

export function describeLastResult(events: unknown[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i] as { type?: string; team?: string; correct?: boolean };
    if (event.type === "ANSWER_JUDGED") {
      const team = TEAM_DISPLAY_LABEL[event.team ?? ""] ?? event.team;
      return event.correct ? `${team} got it!` : `${team} got it wrong.`;
    }
    if (event.type === "ROUND_CLOSED") {
      return "Nobody got it.";
    }
    if (event.type === "GAME_FINISHED") {
      return null; // the game's own "finished" state already covers this
    }
  }
  return null;
}

/** The most recent ANSWER_JUDGED event, if the last thing that happened was a judgment — used for a big CORRECT/INCORRECT beat, straight from what the server actually judged. Same shape as boardQuestion/events.ts's own lastJudgment (ANSWER_JUDGED's `type`/`team`/`correct` fields are identical across every buzzer-race engine in this app), reused verbatim rather than duplicated — see SteamRatingsEngine's own events.ts for the same reuse. */
export { lastJudgment } from "@/app/_shared/boardQuestion/events";
