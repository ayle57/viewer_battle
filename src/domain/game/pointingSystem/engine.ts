import type { ParticipantRole } from "@/domain/session";
import { err, ok, type EngineResult, type GameEngine } from "../kernel";
import { addScore, leadingTeam } from "../scoring";
import { gameFinishedEvent, scoreChangedEvent } from "../events";
import {
  pointingSystemActionSchema,
  pointingSystemConfigSchema,
  type PointingSystemAction,
  type PointingSystemConfig,
  type PointingSystemEvent,
  type PointingSystemRound,
  type PointingSystemState,
} from "./types";

/** What a fresh scoreboard is called until the Host actually names it — see types.ts's own doc comment on why this exists at all. */
const DEFAULT_NAME = "Mini-Game";

function freshRound(index: number): PointingSystemRound {
  // Deterministic, not crypto.randomUUID()/Date.now() — kernel.ts's own
  // rule (`apply` never reads the wall clock, same state+action always
  // produces the same result). `index` (rounds.length at creation time)
  // is already a stable, replay-safe identity.
  return { id: `round-${index + 1}`, label: `Round ${index + 1}`, scores: { TEAM_A: 0, TEAM_B: 0 } };
}

export function createInitialState(config: PointingSystemConfig): PointingSystemState {
  const parsed = pointingSystemConfigSchema.parse(config);
  return {
    status: "in_progress",
    name: parsed.name ?? DEFAULT_NAME,
    rounds: [freshRound(0)],
    scores: { TEAM_A: 0, TEAM_B: 0 },
    winner: null,
  };
}

export function apply(state: PointingSystemState, action: PointingSystemAction): EngineResult<PointingSystemState, PointingSystemEvent> {
  // Re-validated regardless of the static type — see kernel.ts: `action`
  // is what a socket/tRPC handler decoded from untrusted JSON.
  const parsed = pointingSystemActionSchema.safeParse(action);
  if (!parsed.success) {
    return err("INVALID_ACTION", parsed.error.issues[0]?.message ?? "Invalid action");
  }
  const validated = parsed.data;

  if (state.status === "finished") {
    return err("GAME_ALREADY_FINISHED", "This game has already finished.");
  }

  switch (validated.type) {
    case "SET_NAME":
      return applySetName(state, validated.by, validated.name);
    case "SET_ROUND_LABEL":
      return applySetRoundLabel(state, validated.by, validated.label);
    case "ADD_POINTS":
      return applyAddPoints(state, validated.by, validated.team, validated.delta);
    case "NEXT_ROUND":
      return applyNextRound(state, validated.by);
    case "END_GAME":
      return applyEndGame(state, validated.by);
  }
}

function applySetName(state: PointingSystemState, by: ParticipantRole, name: string): EngineResult<PointingSystemState, PointingSystemEvent> {
  if (by !== "HOST") return err("FORBIDDEN_ROLE", "Only the host can rename this game.");
  return ok({ ...state, name }, [{ type: "NAME_CHANGED", name }]);
}

function applySetRoundLabel(state: PointingSystemState, by: ParticipantRole, label: string): EngineResult<PointingSystemState, PointingSystemEvent> {
  if (by !== "HOST") return err("FORBIDDEN_ROLE", "Only the host can rename a round.");
  const currentIndex = state.rounds.length - 1;
  const current = state.rounds[currentIndex]!;
  const rounds = state.rounds.map((round, index) => (index === currentIndex ? { ...round, label } : round));
  return ok({ ...state, rounds }, [{ type: "ROUND_LABEL_CHANGED", roundId: current.id, label }]);
}

/** Any nonzero integer, either direction — types.ts's top comment: this engine has no opinion on what an external game's own scoring looks like, it only records what the Host says happened. Updates the current round's own sub-tally AND the running total together, so the total is always exactly the sum of every round's tally by construction. */
function applyAddPoints(
  state: PointingSystemState,
  by: ParticipantRole,
  team: "TEAM_A" | "TEAM_B",
  delta: number,
): EngineResult<PointingSystemState, PointingSystemEvent> {
  if (by !== "HOST") return err("FORBIDDEN_ROLE", "Only the host can award points.");
  const currentIndex = state.rounds.length - 1;
  const rounds = state.rounds.map((round, index) => (index === currentIndex ? { ...round, scores: addScore(round.scores, team, delta) } : round));
  const scores = addScore(state.scores, team, delta);
  return ok({ ...state, rounds, scores }, [scoreChangedEvent(team, delta, scores)]);
}

/** Starts a fresh, zeroed round — types.ts's top comment: nothing to reveal/close first, so this is legal any time the game hasn't finished, as many times as the Host's own activity actually has rounds. */
function applyNextRound(state: PointingSystemState, by: ParticipantRole): EngineResult<PointingSystemState, PointingSystemEvent> {
  if (by !== "HOST") return err("FORBIDDEN_ROLE", "Only the host can start a new round.");
  const nextIndex = state.rounds.length;
  const rounds = [...state.rounds, freshRound(nextIndex)];
  return ok({ ...state, rounds }, [{ type: "ROUND_ADVANCED", roundIndex: nextIndex }]);
}

/** Host stopping the game — same rule as every other engine's applyEndGame: highest current (cumulative) score wins, "TIE" if level. */
function applyEndGame(state: PointingSystemState, by: ParticipantRole): EngineResult<PointingSystemState, PointingSystemEvent> {
  if (by !== "HOST") return err("FORBIDDEN_ROLE", "Only the host can end the game.");
  const winner = leadingTeam(state.scores) ?? "TIE";
  return ok({ ...state, status: "finished", winner }, [gameFinishedEvent(winner, state.scores)]);
}

export function availableActions(state: PointingSystemState, role: ParticipantRole): string[] {
  if (state.status === "finished") return [];
  if (role === "HOST") return ["SET_NAME", "SET_ROUND_LABEL", "ADD_POINTS", "NEXT_ROUND", "END_GAME"];
  return []; // teams and DISPLAY only ever watch this one — the Host is the sole judge of an external game's own scoring (types.ts's top comment)
}

export const pointingSystemEngine: GameEngine<PointingSystemState, PointingSystemAction, PointingSystemEvent, PointingSystemConfig> = {
  id: "pointingSystem",
  // User-facing name only — the engine `id` stays `pointingSystem`
  // everywhere in code. "Scoreboard" reads far better on the landing
  // page / lobby next to "Mini Jeopardy", "GeoGuessr", ….
  label: "Scoreboard",
  description: "A reusable scoreboard for whatever you're playing outside this app — Jackbox Party and friends. Name it, track rounds, award points, done.",
  meta: "2 teams · manual scoring",
  createInitialState,
  apply,
  availableActions,
  getWinner: (state) => (state.status === "finished" ? state.winner : null),
};
