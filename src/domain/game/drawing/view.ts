import type { ParticipantRole } from "@/domain/session";
import type { DrawingPrompt, DrawingState } from "./types";

/**
 * The redaction rule — the prompt (the word/character to draw) is a
 * genuine secret, and unlike either other engine's redaction, it's
 * secret from EVERY non-host role, including the drawer's own team's
 * broadcast room: only the specific drawer should know it, and
 * broadcastGameSnapshot (src/server/sockets/game.ts) delivers one
 * payload per ROLE, not per participant, so this function alone cannot
 * be the drawer's OWN delivery mechanism (see types.ts's top comment).
 * What this function CAN and does guarantee: nobody but HOST ever
 * receives the current or a future prompt's real `text` via ordinary
 * `game:state` — not the teammate, not the opposing team, not Display.
 * A prompt already turned (`index < currentPromptIndex`) is fully public
 * by then — it's already in `history` too, same "no reading ahead, but
 * no hiding the past either" posture as BoardQuestionEngine's played
 * questions / GeoGuessr's played rounds.
 *
 * `drawerName` is deliberately NEVER touched here — see its own doc
 * comment in types.ts: genuinely public the moment it's set, the
 * teammate needs to know WHO is drawing, just not the word.
 */
export function toPublicView(state: DrawingState, viewerRole: ParticipantRole): DrawingState {
  if (viewerRole === "HOST") return state;

  const prompts: DrawingPrompt[] = state.prompts.map((prompt, index) =>
    index < state.currentPromptIndex ? prompt : { ...prompt, text: "" },
  );
  return { ...state, prompts };
}
