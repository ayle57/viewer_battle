import { isTeamRole, TEAM_ROLES, type ParticipantRole, type TeamRole } from "@/domain/session";
import { err, ok, type EngineResult, type GameEngine } from "../kernel";
import { addScore, checkFirstToN, leadingTeam, type Scoreboard } from "../scoring";
import { gameFinishedEvent, scoreChangedEvent } from "../events";
import {
  steamRatingsActionSchema,
  steamRatingsConfigSchema,
  type SteamRatingsAction,
  type SteamRatingsConfig,
  type SteamRatingsEvent,
  type SteamRatingsState,
} from "./types";
import { toPublicView } from "./view";

/** First to 6 correctly-judged rounds wins — the product's stated win condition ("un scoring system simple"), same threshold MusicEngine uses. Not configurable per game start; a real rule, not a magic number. See types.ts's top comment. */
export const STEAM_RATINGS_WIN_THRESHOLD = 6;

export function createInitialState(config: SteamRatingsConfig): SteamRatingsState {
  const parsed = steamRatingsConfigSchema.parse(config);
  return {
    status: "in_progress",
    phase: "guessing",
    rounds: parsed.rounds.map((round) => ({ ...round })),
    currentRoundIndex: 0,
    revealedCount: 0,
    buzzedTeam: null,
    attemptedTeams: [],
    scores: { TEAM_A: 0, TEAM_B: 0 },
    winner: null,
    history: [],
  };
}

export function apply(state: SteamRatingsState, action: SteamRatingsAction): EngineResult<SteamRatingsState, SteamRatingsEvent> {
  // Re-validated regardless of the static type — see kernel.ts: `action`
  // is what a socket/tRPC handler decoded from untrusted JSON.
  const parsed = steamRatingsActionSchema.safeParse(action);
  if (!parsed.success) {
    return err("INVALID_ACTION", parsed.error.issues[0]?.message ?? "Invalid action");
  }
  const validated = parsed.data;

  if (state.status === "finished") {
    return err("GAME_ALREADY_FINISHED", "This game has already finished.");
  }

  switch (validated.type) {
    case "REVEAL_NEXT_RATING":
      return applyRevealNextRating(state, validated.by);
    case "BUZZ":
      return applyBuzz(state, validated.by);
    case "JUDGE_ANSWER":
      return applyJudgeAnswer(state, validated.by, validated.correct);
    case "SKIP_ROUND":
      return applySkipRound(state, validated.by);
    case "NEXT_ROUND":
      return applyNextRound(state, validated.by);
    case "END_GAME":
      return applyEndGame(state, validated.by);
  }
}

/**
 * Reveals the current round's next Steam rating — the literal "il met une
 * quantite qu'il veut de steam ratings... buzzers et... ajoute des steam
 * ratings" mechanic: entirely Host-paced, one at a time, least obvious to
 * most obvious (the array's own order, set once in the Content Studio).
 * Legal only from "guessing" — paused while a team is actively answering
 * (types.ts's top comment), and only while ratings remain.
 */
function applyRevealNextRating(state: SteamRatingsState, by: ParticipantRole): EngineResult<SteamRatingsState, SteamRatingsEvent> {
  if (by !== "HOST") return err("FORBIDDEN_ROLE", "Only the host can reveal the next rating.");
  if (state.phase !== "guessing") {
    return err("WRONG_PHASE", `Cannot reveal a rating during phase "${state.phase}".`);
  }
  const round = state.rounds[state.currentRoundIndex];
  if (!round) return err("ROUND_NOT_FOUND", "The active round no longer exists.");
  if (state.revealedCount >= round.ratings.length) {
    return err("NO_RATINGS_REMAINING", "Every rating for this round has already been revealed.");
  }
  const revealedCount = state.revealedCount + 1;
  return ok({ ...state, revealedCount }, [{ type: "RATING_REVEALED", roundIndex: state.currentRoundIndex, revealedCount }]);
}

/** Opens the buzzer race — same shape as MusicEngine's applyBuzz. Requires at least one rating to already be visible (types.ts's top comment: guessing off zero evidence isn't the game). */
function applyBuzz(state: SteamRatingsState, by: ParticipantRole): EngineResult<SteamRatingsState, SteamRatingsEvent> {
  if (!isTeamRole(by)) return err("FORBIDDEN_ROLE", "Only a team may buzz in.");
  if (state.phase !== "guessing") {
    return err("WRONG_PHASE", `Cannot buzz during phase "${state.phase}".`);
  }
  if (state.revealedCount === 0) {
    return err("NOTHING_REVEALED_YET", "Wait for the Host to reveal at least one rating first.");
  }
  if (state.attemptedTeams.includes(by)) {
    return err("TEAM_ALREADY_ATTEMPTED", `${by} has already attempted this round.`);
  }
  const nextState: SteamRatingsState = { ...state, phase: "answering", buzzedTeam: by };
  return ok(nextState, [{ type: "TEAM_BUZZED", team: by }]);
}

/** Judges the buzzing team's ORAL answer (types.ts's top comment — no SUBMIT_ANSWER step exists in this engine) — legal the instant a team has buzzed. */
function applyJudgeAnswer(state: SteamRatingsState, by: ParticipantRole, correct: boolean): EngineResult<SteamRatingsState, SteamRatingsEvent> {
  if (by !== "HOST") return err("FORBIDDEN_ROLE", "Only the host judges an answer.");
  if (state.phase !== "answering" || !state.buzzedTeam) {
    return err("WRONG_PHASE", `Cannot judge an answer during phase "${state.phase}".`);
  }
  const team = state.buzzedTeam;
  const round = state.rounds[state.currentRoundIndex];
  if (!round) return err("ROUND_NOT_FOUND", "The active round no longer exists.");

  const events: SteamRatingsEvent[] = [];

  if (correct) {
    const scores = addScore(state.scores, team, 1);
    events.push({ type: "ANSWER_JUDGED", team, correct: true });
    events.push(scoreChangedEvent(team, 1, scores));
    return finishOrContinue(closeRound(state, round.id, team, scores), events);
  }

  events.push({ type: "ANSWER_JUDGED", team, correct: false });
  const attemptedTeams = [...state.attemptedTeams, team];
  const anyTeamLeftToTry = TEAM_ROLES.some((t) => !attemptedTeams.includes(t));

  if (anyTeamLeftToTry) {
    // A steal is still possible — reopen the floor, don't close the round.
    return ok({ ...state, phase: "guessing", buzzedTeam: null, attemptedTeams }, events);
  }

  // Both teams tried and neither got it — the round closes with no winner.
  events.push({ type: "ROUND_CLOSED", roundId: round.id, wonBy: null });
  return finishOrContinue(closeRound({ ...state, attemptedTeams }, round.id, null, state.scores), events);
}

/**
 * Host escape hatch — "nobody's getting this one," closes the round with
 * no winner. Mirrors MusicEngine's SKIP_ROUND. Not legal from "revealed"
 * (already closed, nothing left to skip) or before at least one rating
 * has been shown (a Host who wants out that early has END_GAME instead).
 */
function applySkipRound(state: SteamRatingsState, by: ParticipantRole): EngineResult<SteamRatingsState, SteamRatingsEvent> {
  if (by !== "HOST") return err("FORBIDDEN_ROLE", "Only the host can skip a round.");
  if (state.phase === "revealed") {
    return err("WRONG_PHASE", `Cannot skip a round during phase "${state.phase}".`);
  }
  if (state.revealedCount === 0) {
    return err("NOTHING_REVEALED_YET", "Reveal at least one rating before skipping this round.");
  }
  const round = state.rounds[state.currentRoundIndex];
  if (!round) return err("ROUND_NOT_FOUND", "The active round no longer exists.");
  return finishOrContinue(closeRound(state, round.id, null, state.scores), [{ type: "ROUND_CLOSED", roundId: round.id, wonBy: null }]);
}

/** Marks a round played and reveals it — shared tail of every path that ends a round (correct answer, both teams failed, or a Host skip). Mirrors MusicEngine's closeRound / BoardQuestionEngine's closeQuestion. */
function closeRound(state: SteamRatingsState, roundId: string, wonBy: TeamRole | null, scores: Scoreboard): SteamRatingsState {
  return {
    ...state,
    phase: "revealed",
    buzzedTeam: null,
    attemptedTeams: [],
    scores,
    history: [...state.history, { roundId, wonBy }],
  };
}

/**
 * Once a round is genuinely revealed, decides what happens next:
 * first-to-STEAM_RATINGS_WIN_THRESHOLD or the board's last round just
 * played both mean the game is over now — same "decide immediately,
 * don't wait for a further action" shape as MusicEngine's own
 * finishOrContinue. Otherwise the round just stays revealed, waiting for
 * NEXT_ROUND.
 */
function finishOrContinue(state: SteamRatingsState, events: SteamRatingsEvent[]): EngineResult<SteamRatingsState, SteamRatingsEvent> {
  const reachedThreshold = checkFirstToN(state.scores, STEAM_RATINGS_WIN_THRESHOLD).length > 0;
  const noMoreRounds = state.currentRoundIndex >= state.rounds.length - 1;
  if (reachedThreshold || noMoreRounds) {
    const winner = leadingTeam(state.scores) ?? "TIE";
    return ok({ ...state, status: "finished", winner }, [...events, gameFinishedEvent(winner, state.scores)]);
  }
  return ok(state, events);
}

function applyNextRound(state: SteamRatingsState, by: ParticipantRole): EngineResult<SteamRatingsState, SteamRatingsEvent> {
  if (by !== "HOST") return err("FORBIDDEN_ROLE", "Only the host advances to the next round.");
  if (state.phase !== "revealed") {
    return err("WRONG_PHASE", `Cannot advance rounds during phase "${state.phase}".`);
  }
  const nextIndex = state.currentRoundIndex + 1;
  if (nextIndex >= state.rounds.length) {
    // Defensive: finishOrContinue already finishes the game once the last
    // round is revealed, so this shouldn't normally be reachable.
    return err("NO_ROUNDS_REMAINING", "There are no more rounds to play.");
  }

  const nextState: SteamRatingsState = {
    ...state,
    phase: "guessing",
    currentRoundIndex: nextIndex,
    revealedCount: 0,
    buzzedTeam: null,
    attemptedTeams: [],
  };
  return ok(nextState, [{ type: "ROUND_ADVANCED", roundIndex: nextIndex }]);
}

/**
 * The one real "stop now" transition — highest current score wins, "TIE"
 * if level, whatever round was in progress is simply abandoned. Shared
 * by END_GAME (the only caller today — see applyEndGame).
 */
function finishGameNow(state: SteamRatingsState): SteamRatingsState {
  const winner = leadingTeam(state.scores) ?? "TIE";
  return {
    ...state,
    status: "finished",
    phase: "guessing",
    revealedCount: 0,
    buzzedTeam: null,
    attemptedTeams: [],
    winner,
  };
}

/** Host stopping the game early — same rule as every other engine's applyEndGame: highest current score wins, "TIE" if level. */
function applyEndGame(state: SteamRatingsState, by: ParticipantRole): EngineResult<SteamRatingsState, SteamRatingsEvent> {
  if (by !== "HOST") return err("FORBIDDEN_ROLE", "Only the host can end the game.");
  const winner = leadingTeam(state.scores) ?? "TIE";
  const nextState = finishGameNow(state);
  return ok(nextState, [gameFinishedEvent(winner, state.scores)]);
}

export function availableActions(state: SteamRatingsState, role: ParticipantRole): string[] {
  if (state.status === "finished") return [];
  const round = state.rounds[state.currentRoundIndex];
  if (role === "HOST") {
    const hostAlways = ["END_GAME"];
    switch (state.phase) {
      case "guessing": {
        const canReveal = round !== undefined && state.revealedCount < round.ratings.length;
        const canSkip = state.revealedCount > 0;
        return [...(canReveal ? ["REVEAL_NEXT_RATING"] : []), ...(canSkip ? ["SKIP_ROUND"] : []), ...hostAlways];
      }
      case "answering":
        // Legal the instant a team has buzzed — no typed-answer step to
        // wait on, this file's top comment: answers are oral.
        return ["JUDGE_ANSWER", "SKIP_ROUND", ...hostAlways];
      case "revealed":
        return ["NEXT_ROUND", ...hostAlways];
    }
  }
  if (!isTeamRole(role)) return []; // DISPLAY never acts
  if (state.phase === "guessing" && state.revealedCount > 0 && !state.attemptedTeams.includes(role)) return ["BUZZ"];
  return [];
}

export const steamRatingsEngine: GameEngine<SteamRatingsState, SteamRatingsAction, SteamRatingsEvent, SteamRatingsConfig> = {
  id: "steamRatings",
  label: "Guess the Game",
  description: "The Host reveals a game's own Steam reviews, one at a time, least obvious first — buzz in and name it before the other team steals it.",
  meta: "2 teams · buzzer",
  hasContentStudio: true,
  createInitialState,
  apply,
  availableActions,
  toPublicView,
  getWinner: (state) => (state.status === "finished" ? state.winner : null),
};
