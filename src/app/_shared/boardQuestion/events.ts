/**
 * Turns the last broadcast `events` array into a one-line result the
 * player/display screens can show right after a question closes — reads
 * only what the server already sent (see AGENTS.md "no fake data"), never
 * invents anything. Board-question-specific shape, so it lives next to
 * the rest of this game's view code, not in src/ui.
 */
export function describeLastResult(events: unknown[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i] as { type?: string; team?: string; correct?: boolean; pointsAwarded?: number };
    if (event.type === "ANSWER_JUDGED") {
      return event.correct ? `${event.team} got it — +${event.pointsAwarded}` : `${event.team} got it wrong.`;
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
