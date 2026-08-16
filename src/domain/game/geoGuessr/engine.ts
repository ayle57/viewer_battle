import { isTeamRole, TEAM_ROLES, type ParticipantRole, type TeamRole } from "@/domain/session";
import { err, ok, type EngineResult, type GameEngine } from "../kernel";
import { addScore, checkFirstToN, leadingTeam, type Scoreboard } from "../scoring";
import { gameFinishedEvent, scoreChangedEvent } from "../events";
import {
  geoGuessrActionSchema,
  geoGuessrConfigSchema,
  type GeoGuess,
  type GeoGuessrAction,
  type GeoGuessrConfig,
  type GeoGuessrEvent,
  type GeoGuessrState,
  type GeoRoundResult,
} from "./types";
import { toPublicView } from "./view";

/** FIRST TO 6 rounds wins — the product's stated win condition (see types.ts's top comment). Not configurable per game start; a real rule, not a magic number. */
export const GEO_WIN_THRESHOLD = 6;

export function createInitialState(config: GeoGuessrConfig): GeoGuessrState {
  const parsed = geoGuessrConfigSchema.parse(config);
  return {
    status: "in_progress",
    phase: "guessing",
    rounds: parsed.rounds,
    currentRoundIndex: 0,
    guesses: { TEAM_A: null, TEAM_B: null },
    lockedTeams: [],
    roundResult: null,
    history: [],
    scores: { TEAM_A: 0, TEAM_B: 0 },
    winner: null,
  };
}

export function apply(state: GeoGuessrState, action: GeoGuessrAction): EngineResult<GeoGuessrState, GeoGuessrEvent> {
  // Re-validated regardless of the static type — see kernel.ts: `action`
  // is what a socket/tRPC handler decoded from untrusted JSON.
  const parsed = geoGuessrActionSchema.safeParse(action);
  if (!parsed.success) {
    return err("INVALID_ACTION", parsed.error.issues[0]?.message ?? "Invalid action");
  }
  const validated = parsed.data;

  if (state.status === "finished") {
    return err("GAME_ALREADY_FINISHED", "This game has already finished.");
  }

  switch (validated.type) {
    case "SET_GUESS":
      return applySetGuess(state, validated.by, { x: validated.x, y: validated.y });
    case "LOCK_GUESS":
      return applyLockGuess(state, validated.by);
    case "NEXT_ROUND":
      return applyNextRound(state, validated.by);
    case "END_GAME":
      return applyEndGame(state, validated.by);
  }
}

function applySetGuess(state: GeoGuessrState, by: ParticipantRole, guess: GeoGuess): EngineResult<GeoGuessrState, GeoGuessrEvent> {
  if (!isTeamRole(by)) return err("FORBIDDEN_ROLE", "Only a team may set a guess.");
  if (state.phase !== "guessing") {
    return err("WRONG_PHASE", `Cannot set a guess during phase "${state.phase}".`);
  }
  if (state.lockedTeams.includes(by)) {
    return err("TEAM_ALREADY_LOCKED", `${by} has already locked its guess for this round.`);
  }

  const nextState: GeoGuessrState = { ...state, guesses: { ...state.guesses, [by]: guess } };
  return ok(nextState, [{ type: "GUESS_SET", team: by }]);
}

function applyLockGuess(state: GeoGuessrState, by: ParticipantRole): EngineResult<GeoGuessrState, GeoGuessrEvent> {
  if (!isTeamRole(by)) return err("FORBIDDEN_ROLE", "Only a team may lock a guess.");
  if (state.phase !== "guessing") {
    return err("WRONG_PHASE", `Cannot lock a guess during phase "${state.phase}".`);
  }
  if (state.lockedTeams.includes(by)) {
    return err("TEAM_ALREADY_LOCKED", `${by} has already locked its guess for this round.`);
  }
  const guess = state.guesses[by];
  if (!guess) return err("NO_GUESS_SET", "Place a guess on the map before locking it in.");

  const lockedTeams: TeamRole[] = [...state.lockedTeams, by];
  const events: GeoGuessrEvent[] = [{ type: "TEAM_LOCKED", team: by }];

  const bothLocked = TEAM_ROLES.every((team) => lockedTeams.includes(team));
  if (!bothLocked) {
    return ok({ ...state, lockedTeams }, events);
  }

  // Second lock just landed — reveal now (see types.ts's top comment on
  // why this is computed here, not via a separate host action or timer).
  const round = state.rounds[state.currentRoundIndex];
  // `targetX`/`targetY` are only ever `null` in a REDACTED view
  // (view.ts) — `apply` always runs against real, full, host-eyes state
  // (never fed a redacted one back in), and geoGuessrConfigSchema
  // requires both on every round at game creation. Still guarded, not
  // asserted, so a genuinely malformed state fails with a real error
  // instead of a crash or silently wrong distance math.
  if (!round || round.targetX === null || round.targetY === null) {
    return err("ROUND_NOT_FOUND", "The active round no longer exists.");
  }
  const target = { targetX: round.targetX, targetY: round.targetY }; // narrowed to non-null numbers, unlike `round` itself

  const guesses = state.guesses as Record<TeamRole, GeoGuess>; // both real: bothLocked implies both teams called SET_GUESS at least once (LOCK_GUESS requires it above)
  const distances: Record<TeamRole, number> = {
    TEAM_A: distanceTo(guesses.TEAM_A, target),
    TEAM_B: distanceTo(guesses.TEAM_B, target),
  };
  const roundWinner = closerTeam(distances);
  const result: GeoRoundResult = { roundIndex: state.currentRoundIndex, targetX: target.targetX, targetY: target.targetY, guesses, distances, roundWinner };
  events.push({ type: "ROUND_REVEALED", result });

  let scores: Scoreboard = state.scores;
  if (roundWinner !== "TIE") {
    scores = addScore(scores, roundWinner, 1);
    events.push(scoreChangedEvent(roundWinner, 1, scores));
  }

  const revealedState: GeoGuessrState = { ...state, phase: "revealed", lockedTeams, roundResult: result, history: [...state.history, result], scores };

  // First to GEO_WIN_THRESHOLD, or the board's last round just played —
  // either way the game is over now, same "decide immediately, don't
  // wait for a further action" shape as BoardQuestionEngine's
  // finishIfBoardComplete.
  const reachedThreshold = checkFirstToN(scores, GEO_WIN_THRESHOLD).length > 0;
  const noMoreRounds = state.currentRoundIndex >= state.rounds.length - 1;
  if (reachedThreshold || noMoreRounds) {
    const winner = leadingTeam(scores) ?? "TIE";
    return ok({ ...revealedState, status: "finished", winner }, [...events, gameFinishedEvent(winner, scores)]);
  }

  return ok(revealedState, events);
}

function applyNextRound(state: GeoGuessrState, by: ParticipantRole): EngineResult<GeoGuessrState, GeoGuessrEvent> {
  if (by !== "HOST") return err("FORBIDDEN_ROLE", "Only the host advances to the next round.");
  if (state.phase !== "revealed") {
    return err("WRONG_PHASE", `Cannot advance rounds during phase "${state.phase}".`);
  }
  const nextIndex = state.currentRoundIndex + 1;
  if (nextIndex >= state.rounds.length) {
    // Defensive: applyLockGuess already finishes the game once the last
    // round is revealed, so this shouldn't normally be reachable.
    return err("NO_ROUNDS_REMAINING", "There are no more rounds to play.");
  }

  const nextState: GeoGuessrState = {
    ...state,
    phase: "guessing",
    currentRoundIndex: nextIndex,
    guesses: { TEAM_A: null, TEAM_B: null },
    lockedTeams: [],
    roundResult: null,
  };
  return ok(nextState, [{ type: "ROUND_ADVANCED", roundIndex: nextIndex }]);
}

/** Host stopping the game early — same rule as BoardQuestionEngine's applyEndGame: highest current score wins, "TIE" if level. Whatever round was in progress is simply abandoned. */
function applyEndGame(state: GeoGuessrState, by: ParticipantRole): EngineResult<GeoGuessrState, GeoGuessrEvent> {
  if (by !== "HOST") return err("FORBIDDEN_ROLE", "Only the host can end the game.");

  const winner = leadingTeam(state.scores) ?? "TIE";
  const nextState: GeoGuessrState = {
    ...state,
    status: "finished",
    phase: "guessing",
    guesses: { TEAM_A: null, TEAM_B: null },
    lockedTeams: [],
    winner,
  };
  return ok(nextState, [gameFinishedEvent(winner, state.scores)]);
}

function distanceTo(guess: GeoGuess, round: { targetX: number; targetY: number }): number {
  return Math.hypot(guess.x - round.targetX, guess.y - round.targetY);
}

/** Lower distance wins — the inverse comparison of scoring.ts's leadingTeam (higher wins), so not reused directly; GeoGuessr-specific on purpose. */
function closerTeam(distances: Record<TeamRole, number>): TeamRole | "TIE" {
  const [a, b] = TEAM_ROLES;
  if (distances[a] === distances[b]) return "TIE";
  return distances[a] < distances[b] ? a : b;
}

export function availableActions(state: GeoGuessrState, role: ParticipantRole): string[] {
  if (state.status === "finished") return [];
  const hostCanAlwaysEnd = role === "HOST" ? ["END_GAME"] : [];
  if (role === "HOST") {
    return state.phase === "revealed" ? ["NEXT_ROUND", ...hostCanAlwaysEnd] : [...hostCanAlwaysEnd];
  }
  if (!isTeamRole(role)) return []; // DISPLAY never acts
  if (state.phase !== "guessing" || state.lockedTeams.includes(role)) return [];
  return state.guesses[role] ? ["SET_GUESS", "LOCK_GUESS"] : ["SET_GUESS"];
}

export const geoGuessrEngine: GameEngine<GeoGuessrState, GeoGuessrAction, GeoGuessrEvent, GeoGuessrConfig> = {
  id: "geoguessr",
  label: "GeoGuessr",
  description: "Two teams, one map — place your guess, lock it in, closest to the target wins the round.",
  meta: "2 teams · map guessing",
  hasContentStudio: true,
  createInitialState,
  apply,
  availableActions,
  toPublicView,
  getWinner: (state) => (state.status === "finished" ? state.winner : null),
};
