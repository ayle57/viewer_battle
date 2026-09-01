import type { ParticipantRole } from "@/domain/session";
import type { MusicRound, MusicState } from "./types";

/**
 * The redaction rule — same "HOST sees everything, no reading (or in
 * this case listening) ahead on future rounds" posture as GeoGuessr's
 * own `toPublicView` (types.ts's top comment explains WHY this engine,
 * unlike BoardQuestionEngine, reveals its answer at all):
 *
 *   - The CURRENT round's `audioUrl` is visible only once it's actually
 *     playable — `phase` has left "intro" (the round's mandatory first
 *     shared play has happened, see types.ts's top comment on "premiere
 *     lecture commune") — its `title`/`artist` (the actual answer) stay
 *     hidden until `phase === "revealed"`. While still "intro", the
 *     current round is treated exactly like a future one: nothing to
 *     see or hear yet, not even the audio — a player's own client
 *     shouldn't be able to start listening before the shared reveal
 *     moment everyone (Host + Display) experiences together.
 *   - A played round (index < currentRoundIndex) or the current one
 *     once revealed is fully public.
 *   - Any FUTURE round (index > current) is fully blanked, `audioUrl`
 *     included — a player scrubbing the network tab shouldn't be able
 *     to preview next round's clip early.
 *
 * Redacted `title`/`artist` become `null` (not `""` — GeoGuessr uses
 * `null` for its own redacted numeric target for the same reason: no
 * sensible placeholder value), keeping the return type identical to
 * `MusicState` as `GameEngine.toPublicView` requires.
 */
export function toPublicView(state: MusicState, viewerRole: ParticipantRole): MusicState {
  if (viewerRole === "HOST") return state;
  const rounds: MusicRound[] = state.rounds.map((round, index) => redactRound(round, index, state));
  return { ...state, rounds };
}

function redactRound(round: MusicRound, index: number, state: MusicState): MusicRound {
  const played = index < state.currentRoundIndex;
  const isCurrentRevealed = index === state.currentRoundIndex && state.phase === "revealed";
  if (played || isCurrentRevealed) return round; // fully public by now

  const isCurrentPlayable = index === state.currentRoundIndex && state.phase !== "intro";
  if (isCurrentPlayable) {
    // Audible now — title/artist (the answer) still hidden.
    return { ...round, title: null, artist: null };
  }

  // Either a future round, or the current one still in "intro" (the
  // Host hasn't shared-played it yet) — no reading/listening ahead.
  return { id: round.id, audioUrl: "", title: null, artist: null };
}
