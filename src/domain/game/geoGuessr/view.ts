import type { ParticipantRole, TeamRole } from "@/domain/session";
import { isTeamRole } from "@/domain/session";
import type { GeoGuess, GeoGuessrState, GeoProposal, GeoRound } from "./types";

/**
 * The redaction rule — see types.ts's top comment for why this engine
 * needs a genuinely PER-TEAM view (BoardQuestionEngine's toPublicView
 * treats every non-host role identically; this one can't). HOST sees
 * everything, always. For every other role:
 *
 *   - `rounds[i]`: a round already played (in history) or the current
 *     round while `phase === "revealed"` is fully visible, target
 *     included — it's public information by then. The CURRENT round
 *     while still `guessing` shows its image/title/question (the whole
 *     point — you have to be able to see the map AND know what you're
 *     looking for to guess) but its target is redacted to `null`. Any
 *     FUTURE round (index > current) is fully blanked — no reading
 *     ahead, same posture as BoardQuestionEngine's unrevealed questions.
 *   - `guesses`: a TEAM viewer always sees their OWN entry (it's their
 *     own pointer) but the OTHER team's entry is redacted to `null`
 *     until `phase === "revealed"` — the private-ping requirement this
 *     whole engine exists to prove out. DISPLAY never sees either
 *     team's live guess pre-reveal; both become visible, like
 *     everyone else's, once revealed.
 *   - `proposals`: the same "own team only" posture as `guesses`, always
 *     — a team's candidate spots stay private to that team even after
 *     `guesses` itself goes public at reveal, since a proposal that
 *     never got locked was never anyone's real answer.
 *
 * Redacted numeric fields become `null` (not `""` — there's no sensible
 * string placeholder for a coordinate), keeping the return type
 * identical to `GeoGuessrState` as `GameEngine.toPublicView` requires,
 * same shape-preserving posture as BoardQuestionEngine's `toPublicView`.
 */
export function toPublicView(state: GeoGuessrState, viewerRole: ParticipantRole): GeoGuessrState {
  if (viewerRole === "HOST") return state;

  const rounds: GeoRound[] = state.rounds.map((round, index) => redactRound(round, index, state));

  const guesses: Record<TeamRole, GeoGuess | null> = {
    TEAM_A: redactGuess("TEAM_A", state, viewerRole),
    TEAM_B: redactGuess("TEAM_B", state, viewerRole),
  };

  // Same "your own team's, never the opponent's" posture as `guesses` —
  // a proposal is a private in-team candidate (types.ts's
  // GeoGuessrState.proposals doc comment), not information the other
  // team should ever see, and DISPLAY has no team to see either team's
  // proposals from.
  const proposals: Record<TeamRole, GeoProposal[]> = {
    TEAM_A: isTeamRole(viewerRole) && viewerRole === "TEAM_A" ? state.proposals.TEAM_A : [],
    TEAM_B: isTeamRole(viewerRole) && viewerRole === "TEAM_B" ? state.proposals.TEAM_B : [],
  };

  // `countdownDeadline` deliberately isn't touched here — see its own
  // doc comment on types.ts's GeoGuessrState: unlike every field above,
  // it's genuinely public, so the `...state` spread already carries it
  // through byte-identical for every role, HOST included.
  return { ...state, rounds, guesses, proposals };
}

function redactRound(round: GeoRound, index: number, state: GeoGuessrState): GeoRound {
  const played = index < state.currentRoundIndex || state.history.some((h) => h.roundIndex === index);
  const isCurrentRevealed = index === state.currentRoundIndex && state.phase === "revealed";
  if (played || isCurrentRevealed) return round; // fully public by now

  const isCurrentGuessing = index === state.currentRoundIndex && state.phase === "guessing";
  if (isCurrentGuessing) {
    // Playable now — image/title visible, target hidden.
    return { ...round, targetX: null, targetY: null };
  }

  // A future round — no reading ahead at all.
  return { id: round.id, imageUrl: "", question: "", targetX: null, targetY: null, title: "" };
}

function redactGuess(team: TeamRole, state: GeoGuessrState, viewerRole: ParticipantRole): GeoGuess | null {
  if (state.phase === "revealed") return state.guesses[team]; // public once revealed, for every role
  if (isTeamRole(viewerRole) && viewerRole === team) return state.guesses[team]; // always see your own
  return null; // the other team's (or DISPLAY's view of either) live guess is private
}
