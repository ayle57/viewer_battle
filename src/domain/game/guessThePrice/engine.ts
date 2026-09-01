import { isTeamRole, TEAM_ROLES, type ParticipantRole, type TeamRole } from "@/domain/session";
import { err, ok, type EngineResult, type GameEngine } from "../kernel";
import { addScore, checkFirstToN, leadingTeam, type Scoreboard } from "../scoring";
import { gameFinishedEvent, scoreChangedEvent } from "../events";
import {
  guessThePriceActionSchema,
  guessThePriceConfigSchema,
  type GuessThePriceAction,
  type GuessThePriceConfig,
  type GuessThePriceEvent,
  type GuessThePriceState,
} from "./types";
import { toPublicView } from "./view";

/** First to 6 correctly-judged rounds wins — same threshold Music/SteamRatings both use ("un scoring system simple"). Not configurable per game start; a real rule, not a magic number. See types.ts's top comment. */
export const GUESS_THE_PRICE_WIN_THRESHOLD = 6;

export function createInitialState(config: GuessThePriceConfig): GuessThePriceState {
  const parsed = guessThePriceConfigSchema.parse(config);
  return {
    status: "in_progress",
    phase: "guessing",
    rounds: parsed.rounds.map((round) => ({ ...round, marginPercent: round.marginPercent ?? null })),
    currentRoundIndex: 0,
    buzzedTeam: null,
    submittedGuess: null,
    attemptedTeams: [],
    scores: { TEAM_A: 0, TEAM_B: 0 },
    winner: null,
    history: [],
  };
}

export function apply(state: GuessThePriceState, action: GuessThePriceAction): EngineResult<GuessThePriceState, GuessThePriceEvent> {
  // Re-validated regardless of the static type — see kernel.ts: `action`
  // is what a socket/tRPC handler decoded from untrusted JSON.
  const parsed = guessThePriceActionSchema.safeParse(action);
  if (!parsed.success) {
    return err("INVALID_ACTION", parsed.error.issues[0]?.message ?? "Invalid action");
  }
  const validated = parsed.data;

  if (state.status === "finished") {
    return err("GAME_ALREADY_FINISHED", "This game has already finished.");
  }

  switch (validated.type) {
    case "BUZZ":
      return applyBuzz(state, validated.by);
    case "SUBMIT_ANSWER":
      return applySubmitAnswer(state, validated.by, validated.guess);
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

/** Opens the buzzer race — same shape as SteamRatingsEngine's applyBuzz, minus its "at least one rating revealed" precondition: this game has nothing to progressively reveal, the item is public the instant its round starts (types.ts's top comment), so a round being live at all is enough to buzz. */
function applyBuzz(state: GuessThePriceState, by: ParticipantRole): EngineResult<GuessThePriceState, GuessThePriceEvent> {
  if (!isTeamRole(by)) return err("FORBIDDEN_ROLE", "Only a team may buzz in.");
  if (state.phase !== "guessing") {
    return err("WRONG_PHASE", `Cannot buzz during phase "${state.phase}".`);
  }
  if (state.attemptedTeams.includes(by)) {
    return err("TEAM_ALREADY_ATTEMPTED", `${by} has already attempted this round.`);
  }
  const nextState: GuessThePriceState = { ...state, phase: "answering", buzzedTeam: by, submittedGuess: null };
  return ok(nextState, [{ type: "TEAM_BUZZED", team: by }]);
}

/** The buzzing team's own typed price guess — same shape as MusicEngine's applySubmitAnswer, `guess` a float instead of free text. Only the team currently holding the floor may submit, and only once per buzz. */
function applySubmitAnswer(state: GuessThePriceState, by: ParticipantRole, guess: number): EngineResult<GuessThePriceState, GuessThePriceEvent> {
  if (!isTeamRole(by)) return err("FORBIDDEN_ROLE", "Only a team may submit an answer.");
  if (state.phase !== "answering" || !state.buzzedTeam) {
    return err("WRONG_PHASE", `Cannot submit an answer during phase "${state.phase}".`);
  }
  if (by !== state.buzzedTeam) {
    return err("FORBIDDEN_ROLE", "Only the team that buzzed may submit an answer.");
  }
  if (state.submittedGuess !== null) {
    return err("ANSWER_ALREADY_SUBMITTED", `${by} already submitted a guess for this buzz.`);
  }
  const nextState: GuessThePriceState = { ...state, submittedGuess: guess };
  return ok(nextState, [{ type: "ANSWER_SUBMITTED", team: by, guess }]);
}

/** Judges the buzzing team's submitted guess — legal only once SUBMIT_ANSWER has actually landed (types.ts's top comment: no auto-judging off `marginPercent`, the Host always has the final word). */
function applyJudgeAnswer(state: GuessThePriceState, by: ParticipantRole, correct: boolean): EngineResult<GuessThePriceState, GuessThePriceEvent> {
  if (by !== "HOST") return err("FORBIDDEN_ROLE", "Only the host judges an answer.");
  if (state.phase !== "answering" || !state.buzzedTeam) {
    return err("WRONG_PHASE", `Cannot judge an answer during phase "${state.phase}".`);
  }
  if (state.submittedGuess === null) {
    return err("ANSWER_NOT_SUBMITTED", "Wait for the team's guess before judging.");
  }
  const team = state.buzzedTeam;
  const round = state.rounds[state.currentRoundIndex];
  if (!round) return err("ROUND_NOT_FOUND", "The active round no longer exists.");

  const events: GuessThePriceEvent[] = [];

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
    return ok({ ...state, phase: "guessing", buzzedTeam: null, submittedGuess: null, attemptedTeams }, events);
  }

  // Both teams tried and neither got it — the round closes with no winner.
  events.push({ type: "ROUND_CLOSED", roundId: round.id, wonBy: null });
  return finishOrContinue(closeRound({ ...state, attemptedTeams }, round.id, null, state.scores), events);
}

/**
 * Host escape hatch — "nobody's getting this one," closes the round with
 * no winner. Mirrors SteamRatingsEngine's SKIP_ROUND, minus its "at
 * least one rating revealed" precondition (types.ts's top comment: there
 * is no equivalent floor here — a round is live, and thus skippable,
 * the instant it starts). Not legal from "revealed" (already closed,
 * nothing left to skip).
 */
function applySkipRound(state: GuessThePriceState, by: ParticipantRole): EngineResult<GuessThePriceState, GuessThePriceEvent> {
  if (by !== "HOST") return err("FORBIDDEN_ROLE", "Only the host can skip a round.");
  if (state.phase === "revealed") {
    return err("WRONG_PHASE", `Cannot skip a round during phase "${state.phase}".`);
  }
  const round = state.rounds[state.currentRoundIndex];
  if (!round) return err("ROUND_NOT_FOUND", "The active round no longer exists.");
  return finishOrContinue(closeRound(state, round.id, null, state.scores), [{ type: "ROUND_CLOSED", roundId: round.id, wonBy: null }]);
}

/** Marks a round played and reveals it — shared tail of every path that ends a round (correct answer, both teams failed, or a Host skip). Mirrors SteamRatingsEngine's closeRound / MusicEngine's closeRound. */
function closeRound(state: GuessThePriceState, roundId: string, wonBy: TeamRole | null, scores: Scoreboard): GuessThePriceState {
  return {
    ...state,
    phase: "revealed",
    buzzedTeam: null,
    submittedGuess: null,
    attemptedTeams: [],
    scores,
    history: [...state.history, { roundId, wonBy }],
  };
}

/**
 * Once a round is genuinely revealed, decides what happens next:
 * first-to-GUESS_THE_PRICE_WIN_THRESHOLD or the board's last round just
 * played both mean the game is over now — same "decide immediately,
 * don't wait for a further action" shape as SteamRatingsEngine's own
 * finishOrContinue. Otherwise the round just stays revealed, waiting for
 * NEXT_ROUND.
 */
function finishOrContinue(state: GuessThePriceState, events: GuessThePriceEvent[]): EngineResult<GuessThePriceState, GuessThePriceEvent> {
  const reachedThreshold = checkFirstToN(state.scores, GUESS_THE_PRICE_WIN_THRESHOLD).length > 0;
  const noMoreRounds = state.currentRoundIndex >= state.rounds.length - 1;
  if (reachedThreshold || noMoreRounds) {
    const winner = leadingTeam(state.scores) ?? "TIE";
    return ok({ ...state, status: "finished", winner }, [...events, gameFinishedEvent(winner, state.scores)]);
  }
  return ok(state, events);
}

function applyNextRound(state: GuessThePriceState, by: ParticipantRole): EngineResult<GuessThePriceState, GuessThePriceEvent> {
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

  const nextState: GuessThePriceState = {
    ...state,
    phase: "guessing",
    currentRoundIndex: nextIndex,
    buzzedTeam: null,
    submittedGuess: null,
    attemptedTeams: [],
  };
  return ok(nextState, [{ type: "ROUND_ADVANCED", roundIndex: nextIndex }]);
}

/**
 * The one real "stop now" transition — highest current score wins, "TIE"
 * if level, whatever round was in progress is simply abandoned. Shared
 * by END_GAME (the only caller today — see applyEndGame).
 */
function finishGameNow(state: GuessThePriceState): GuessThePriceState {
  const winner = leadingTeam(state.scores) ?? "TIE";
  return {
    ...state,
    status: "finished",
    phase: "guessing",
    buzzedTeam: null,
    submittedGuess: null,
    attemptedTeams: [],
    winner,
  };
}

/** Host stopping the game early — same rule as every other engine's applyEndGame: highest current score wins, "TIE" if level. */
function applyEndGame(state: GuessThePriceState, by: ParticipantRole): EngineResult<GuessThePriceState, GuessThePriceEvent> {
  if (by !== "HOST") return err("FORBIDDEN_ROLE", "Only the host can end the game.");
  const winner = leadingTeam(state.scores) ?? "TIE";
  const nextState = finishGameNow(state);
  return ok(nextState, [gameFinishedEvent(winner, state.scores)]);
}

export function availableActions(state: GuessThePriceState, role: ParticipantRole): string[] {
  if (state.status === "finished") return [];
  const round = state.rounds[state.currentRoundIndex];
  if (role === "HOST") {
    const hostAlways = ["END_GAME"];
    switch (state.phase) {
      case "guessing":
        return [...(round ? ["SKIP_ROUND"] : []), ...hostAlways];
      case "answering":
        return state.submittedGuess !== null ? ["JUDGE_ANSWER", "SKIP_ROUND", ...hostAlways] : ["SKIP_ROUND", ...hostAlways];
      case "revealed":
        return ["NEXT_ROUND", ...hostAlways];
    }
  }
  if (!isTeamRole(role)) return []; // DISPLAY never acts
  if (state.phase === "guessing" && !state.attemptedTeams.includes(role)) return ["BUZZ"];
  if (state.phase === "answering" && state.buzzedTeam === role && state.submittedGuess === null) return ["SUBMIT_ANSWER"];
  return [];
}

export const guessThePriceEngine: GameEngine<GuessThePriceState, GuessThePriceAction, GuessThePriceEvent, GuessThePriceConfig> = {
  id: "guessThePrice",
  label: "Guess the Price",
  description: "The Host shows an item — buzz in and type your price guess before the other team steals it.",
  meta: "2 teams · buzzer",
  hasContentStudio: true,
  createInitialState,
  apply,
  availableActions,
  toPublicView,
  getWinner: (state) => (state.status === "finished" ? state.winner : null),
};
