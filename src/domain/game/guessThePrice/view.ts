import type { ParticipantRole } from "@/domain/session";
import type { PriceRound, GuessThePriceState } from "./types";

/**
 * The redaction rule — same "HOST sees everything" posture as
 * SteamRatingsEngine's own `toPublicView` (types.ts's top comment
 * explains WHY this engine hides its answer at all), but flipped which
 * fields are secret: here `title`/`imageUrl` are NEVER redacted (this
 * file's counterpart top comment — the item itself is never hidden,
 * only its price), so only `price`/`marginPercent` get blanked:
 *
 *   - The CURRENT round, still in progress: `price`/`marginPercent`
 *     hidden (`null`), `title`/`imageUrl` shown as-is.
 *   - A played round (index < currentRoundIndex) or the current one
 *     once revealed is fully public — `price`/`marginPercent` included.
 *   - Any FUTURE round (index > current) is fully blanked, `title`/
 *     `imageUrl` included — a player scrubbing the network tab
 *     shouldn't be able to preview the next item early, same "no
 *     reading ahead" posture SteamRatingsEngine's own future rounds
 *     have.
 *
 * Redacted `title`/`imageUrl` become `null` for a FUTURE round only (no
 * sensible placeholder value — same reasoning SteamRatingsEngine's own
 * redacted `title`/`imageUrl` use), keeping the return type identical to
 * `GuessThePriceState` as `GameEngine.toPublicView` requires.
 */
export function toPublicView(state: GuessThePriceState, viewerRole: ParticipantRole): GuessThePriceState {
  if (viewerRole === "HOST") return state;
  const rounds: PriceRound[] = state.rounds.map((round, index) => redactRound(round, index, state));
  return { ...state, rounds };
}

function redactRound(round: PriceRound, index: number, state: GuessThePriceState): PriceRound {
  const played = index < state.currentRoundIndex;
  const isCurrentRevealed = index === state.currentRoundIndex && state.phase === "revealed";
  if (played || isCurrentRevealed) return round; // fully public by now

  const isCurrent = index === state.currentRoundIndex;
  if (isCurrent) {
    // In progress — the item itself is public, only the price is secret.
    return { ...round, price: null, marginPercent: null };
  }

  // A future round — no reading ahead at all, item included.
  return { id: round.id, title: null, imageUrl: null, price: null, marginPercent: null };
}
