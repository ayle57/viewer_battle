import type { ParticipantRole } from "@/domain/session";
import type { SteamRatingsRound, SteamRatingsState } from "./types";

/**
 * The redaction rule — same "HOST sees everything, no reading ahead on
 * future rounds" posture as MusicEngine's own `toPublicView` (types.ts's
 * top comment explains WHY this engine reveals its answer at all):
 *
 *   - The CURRENT round's `ratings` are visible only up to
 *     `revealedCount` — everything past that is exactly the "reading
 *     ahead" this whole engine exists to prevent (a Host builds
 *     suspense by controlling the reveal order; a redacted view that
 *     showed every rating up front would defeat the entire mechanic).
 *     `title`/`imageUrl` (the actual answer) stay hidden until
 *     `phase === "revealed"`.
 *   - A played round (index < currentRoundIndex) or the current one once
 *     revealed is fully public — every rating, `title`, `imageUrl`.
 *   - Any FUTURE round (index > current) is fully blanked, `ratings`
 *     included — a player scrubbing the network tab shouldn't be able
 *     to preview the next round's evidence early.
 *
 * Redacted `title`/`imageUrl` become `null` (not `""` — MusicEngine uses
 * `null` for its own redacted `title`/`artist` for the same reason: no
 * sensible placeholder value), keeping the return type identical to
 * `SteamRatingsState` as `GameEngine.toPublicView` requires.
 */
export function toPublicView(state: SteamRatingsState, viewerRole: ParticipantRole): SteamRatingsState {
  if (viewerRole === "HOST") return state;
  const rounds: SteamRatingsRound[] = state.rounds.map((round, index) => redactRound(round, index, state));
  return { ...state, rounds };
}

function redactRound(round: SteamRatingsRound, index: number, state: SteamRatingsState): SteamRatingsRound {
  const played = index < state.currentRoundIndex;
  const isCurrentRevealed = index === state.currentRoundIndex && state.phase === "revealed";
  if (played || isCurrentRevealed) return round; // fully public by now

  const isCurrent = index === state.currentRoundIndex;
  if (isCurrent) {
    // In progress — only the ratings the Host has actually revealed so
    // far, answer still hidden.
    return { id: round.id, title: null, imageUrl: null, ratings: round.ratings.slice(0, state.revealedCount) };
  }

  // A future round — no reading ahead at all.
  return { id: round.id, title: null, imageUrl: null, ratings: [] };
}
