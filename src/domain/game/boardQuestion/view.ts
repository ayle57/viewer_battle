import type { ParticipantRole } from "@/domain/session";
import type { BoardQuestionState } from "./types";

/**
 * The redaction rule (a real gameplay/integrity decision, confirmed
 * explicitly before building this — see AGENTS.md): HOST sees everything.
 * Every other role never sees `answer`, ever — and never sees `prompt`
 * for a question that isn't the active one and hasn't been played yet
 * (no reading ahead on the board). Once a question is active or played,
 * its prompt is visible; its answer still isn't — this app has no "reveal
 * the answer to the audience" moment.
 *
 * Redacted fields become `""`, not `null` — keeps this function's return
 * type identical to `BoardQuestionState` (required by
 * `GameEngine.toPublicView`'s signature) instead of needing a second,
 * nullable-fields variant of the type.
 */
export function toPublicView(state: BoardQuestionState, viewerRole: ParticipantRole): BoardQuestionState {
  if (viewerRole === "HOST") return state;

  return {
    ...state,
    questions: state.questions.map((question) => {
      const visible = question.id === state.activeQuestionId || state.playedQuestionIds.includes(question.id);
      return {
        ...question,
        prompt: visible ? question.prompt : "",
        answer: "",
      };
    }),
  };
}
