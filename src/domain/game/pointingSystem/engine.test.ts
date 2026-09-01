import { describe, expect, it } from "vitest";
import { apply, availableActions, createInitialState } from "./engine";
import type { PointingSystemConfig, PointingSystemState } from "./types";

function freshState(config: PointingSystemConfig = {}): PointingSystemState {
  return createInitialState(config);
}

function mustOk(result: ReturnType<typeof apply>): PointingSystemState {
  if (!result.ok) throw new Error(`expected ok, got error ${result.error.code}: ${result.error.message}`);
  return result.state;
}

describe("createInitialState", () => {
  it("starts in_progress, zero scores, no winner, one round", () => {
    const state = freshState();
    expect(state.status).toBe("in_progress");
    expect(state.scores).toEqual({ TEAM_A: 0, TEAM_B: 0 });
    expect(state.winner).toBeNull();
    expect(state.rounds).toEqual([{ id: "round-1", label: "Round 1", scores: { TEAM_A: 0, TEAM_B: 0 } }]);
  });

  it("defaults the name when config omits one", () => {
    expect(freshState({}).name).toBe("Mini-Game");
  });

  it("uses the config's own name when given", () => {
    expect(freshState({ name: "Jackbox Party" }).name).toBe("Jackbox Party");
  });

  it("does not mutate the input config", () => {
    const config = { name: "Codenames" };
    const before = JSON.stringify(config);
    createInitialState(config);
    expect(JSON.stringify(config)).toBe(before);
  });
});

describe("SET_NAME", () => {
  it("renames the game and emits NAME_CHANGED", () => {
    const result = apply(freshState(), { type: "SET_NAME", by: "HOST", name: "Fibbage" });
    const next = mustOk(result);
    expect(next.name).toBe("Fibbage");
    expect(result.ok && result.events).toEqual([{ type: "NAME_CHANGED", name: "Fibbage" }]);
  });

  it("does not mutate the input state", () => {
    const state = freshState();
    apply(state, { type: "SET_NAME", by: "HOST", name: "Fibbage" });
    expect(state.name).toBe("Mini-Game");
  });

  it("rejects a non-host", () => {
    const result = apply(freshState(), { type: "SET_NAME", by: "TEAM_A", name: "Fibbage" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("FORBIDDEN_ROLE");
  });

  it("rejects an empty name", () => {
    const result = apply(freshState(), { type: "SET_NAME", by: "HOST", name: "  " });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("INVALID_ACTION");
  });
});

describe("SET_ROUND_LABEL", () => {
  it("renames only the current (last) round and emits ROUND_LABEL_CHANGED", () => {
    const result = apply(freshState(), { type: "SET_ROUND_LABEL", by: "HOST", label: "Fibbage" });
    const next = mustOk(result);
    expect(next.rounds[0]!.label).toBe("Fibbage");
    expect(result.ok && result.events).toEqual([{ type: "ROUND_LABEL_CHANGED", roundId: "round-1", label: "Fibbage" }]);
  });

  it("only renames the round that's actually current after NEXT_ROUND", () => {
    const advanced = mustOk(apply(freshState(), { type: "NEXT_ROUND", by: "HOST" }));
    const renamed = mustOk(apply(advanced, { type: "SET_ROUND_LABEL", by: "HOST", label: "Quiplash" }));
    expect(renamed.rounds[0]!.label).toBe("Round 1"); // untouched
    expect(renamed.rounds[1]!.label).toBe("Quiplash");
  });

  it("rejects a non-host", () => {
    const result = apply(freshState(), { type: "SET_ROUND_LABEL", by: "TEAM_A", label: "Fibbage" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("FORBIDDEN_ROLE");
  });
});

describe("ADD_POINTS", () => {
  it("awards points to a team and emits SCORE_CHANGED", () => {
    const result = apply(freshState(), { type: "ADD_POINTS", by: "HOST", team: "TEAM_A", delta: 5 });
    const next = mustOk(result);
    expect(next.scores).toEqual({ TEAM_A: 5, TEAM_B: 0 });
    expect(result.ok && result.events).toEqual([{ type: "SCORE_CHANGED", team: "TEAM_A", delta: 5, scores: { TEAM_A: 5, TEAM_B: 0 } }]);
  });

  it("updates the current round's own sub-tally alongside the running total", () => {
    const next = mustOk(apply(freshState(), { type: "ADD_POINTS", by: "HOST", team: "TEAM_A", delta: 5 }));
    expect(next.rounds[0]!.scores).toEqual({ TEAM_A: 5, TEAM_B: 0 });
  });

  it("only credits points to the CURRENT round after NEXT_ROUND — earlier rounds keep their own history", () => {
    const round1Scored = mustOk(apply(freshState(), { type: "ADD_POINTS", by: "HOST", team: "TEAM_A", delta: 3 }));
    const advanced = mustOk(apply(round1Scored, { type: "NEXT_ROUND", by: "HOST" }));
    const round2Scored = mustOk(apply(advanced, { type: "ADD_POINTS", by: "HOST", team: "TEAM_B", delta: 2 }));

    expect(round2Scored.rounds[0]!.scores).toEqual({ TEAM_A: 3, TEAM_B: 0 }); // Round 1 untouched
    expect(round2Scored.rounds[1]!.scores).toEqual({ TEAM_A: 0, TEAM_B: 2 }); // Round 2's own tally
    expect(round2Scored.scores).toEqual({ TEAM_A: 3, TEAM_B: 2 }); // running total across both
  });

  it("accepts a negative delta to correct a mistake, and can go below zero", () => {
    const withPoints = mustOk(apply(freshState(), { type: "ADD_POINTS", by: "HOST", team: "TEAM_B", delta: 3 }));
    const corrected = mustOk(apply(withPoints, { type: "ADD_POINTS", by: "HOST", team: "TEAM_B", delta: -10 }));
    expect(corrected.scores).toEqual({ TEAM_A: 0, TEAM_B: -7 });
    expect(corrected.rounds[0]!.scores).toEqual({ TEAM_A: 0, TEAM_B: -7 });
  });

  it("does not mutate the input state", () => {
    const state = freshState();
    apply(state, { type: "ADD_POINTS", by: "HOST", team: "TEAM_A", delta: 1 });
    expect(state.scores).toEqual({ TEAM_A: 0, TEAM_B: 0 });
    expect(state.rounds[0]!.scores).toEqual({ TEAM_A: 0, TEAM_B: 0 });
  });

  it("rejects a non-host", () => {
    const result = apply(freshState(), { type: "ADD_POINTS", by: "TEAM_A", team: "TEAM_A", delta: 1 });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("FORBIDDEN_ROLE");
  });

  it("rejects a zero delta", () => {
    const result = apply(freshState(), { type: "ADD_POINTS", by: "HOST", team: "TEAM_A", delta: 0 });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("INVALID_ACTION");
  });

  it("rejects a non-integer delta", () => {
    const result = apply(freshState(), { type: "ADD_POINTS", by: "HOST", team: "TEAM_A", delta: 1.5 });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("INVALID_ACTION");
  });
});

describe("NEXT_ROUND", () => {
  it("appends a fresh, zeroed, auto-labeled round and emits ROUND_ADVANCED", () => {
    const result = apply(freshState(), { type: "NEXT_ROUND", by: "HOST" });
    const next = mustOk(result);
    expect(next.rounds).toHaveLength(2);
    expect(next.rounds[1]).toEqual({ id: "round-2", label: "Round 2", scores: { TEAM_A: 0, TEAM_B: 0 } });
    expect(result.ok && result.events).toEqual([{ type: "ROUND_ADVANCED", roundIndex: 1 }]);
  });

  it("never touches an earlier round's own tally", () => {
    const scored = mustOk(apply(freshState(), { type: "ADD_POINTS", by: "HOST", team: "TEAM_A", delta: 4 }));
    const advanced = mustOk(apply(scored, { type: "NEXT_ROUND", by: "HOST" }));
    expect(advanced.rounds[0]!.scores).toEqual({ TEAM_A: 4, TEAM_B: 0 });
    expect(advanced.scores).toEqual({ TEAM_A: 4, TEAM_B: 0 }); // total unchanged by starting a new round
  });

  it("is repeatable — as many rounds as the Host actually plays", () => {
    let state = freshState();
    for (let i = 0; i < 5; i++) state = mustOk(apply(state, { type: "NEXT_ROUND", by: "HOST" }));
    expect(state.rounds).toHaveLength(6);
    expect(state.rounds[5]!.id).toBe("round-6");
  });

  it("does not mutate the input state", () => {
    const state = freshState();
    apply(state, { type: "NEXT_ROUND", by: "HOST" });
    expect(state.rounds).toHaveLength(1);
  });

  it("rejects a non-host", () => {
    const result = apply(freshState(), { type: "NEXT_ROUND", by: "TEAM_A" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("FORBIDDEN_ROLE");
  });
});

describe("END_GAME", () => {
  it("finishes with the leading team (by running total) as winner", () => {
    const ahead = mustOk(apply(freshState(), { type: "ADD_POINTS", by: "HOST", team: "TEAM_A", delta: 10 }));
    const result = apply(ahead, { type: "END_GAME", by: "HOST" });
    const next = mustOk(result);
    expect(next.status).toBe("finished");
    expect(next.winner).toBe("TEAM_A");
    expect(result.ok && result.events).toEqual([{ type: "GAME_FINISHED", winner: "TEAM_A", scores: { TEAM_A: 10, TEAM_B: 0 } }]);
  });

  it("judges the TOTAL across all rounds, not just the current one", () => {
    const round1 = mustOk(apply(freshState(), { type: "ADD_POINTS", by: "HOST", team: "TEAM_B", delta: 10 }));
    const advanced = mustOk(apply(round1, { type: "NEXT_ROUND", by: "HOST" }));
    const round2 = mustOk(apply(advanced, { type: "ADD_POINTS", by: "HOST", team: "TEAM_A", delta: 3 })); // Team A ahead THIS round only
    const finished = mustOk(apply(round2, { type: "END_GAME", by: "HOST" }));
    expect(finished.winner).toBe("TEAM_B"); // still behind on the running total (10 vs 3)
  });

  it("finishes as a TIE when scores are level", () => {
    const next = mustOk(apply(freshState(), { type: "END_GAME", by: "HOST" }));
    expect(next.winner).toBe("TIE");
  });

  it("rejects a non-host", () => {
    const result = apply(freshState(), { type: "END_GAME", by: "TEAM_A" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("FORBIDDEN_ROLE");
  });

  it("rejects any further action once finished", () => {
    const finished = mustOk(apply(freshState(), { type: "END_GAME", by: "HOST" }));
    const result = apply(finished, { type: "NEXT_ROUND", by: "HOST" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("GAME_ALREADY_FINISHED");
  });
});

describe("availableActions", () => {
  it("gives the Host every action while in progress", () => {
    expect(availableActions(freshState(), "HOST")).toEqual(["SET_NAME", "SET_ROUND_LABEL", "ADD_POINTS", "NEXT_ROUND", "END_GAME"]);
  });

  it("gives teams and DISPLAY nothing — the Host is the sole judge", () => {
    expect(availableActions(freshState(), "TEAM_A")).toEqual([]);
    expect(availableActions(freshState(), "TEAM_B")).toEqual([]);
    expect(availableActions(freshState(), "DISPLAY")).toEqual([]);
  });

  it("gives nobody anything once finished", () => {
    const finished = mustOk(apply(freshState(), { type: "END_GAME", by: "HOST" }));
    expect(availableActions(finished, "HOST")).toEqual([]);
  });
});
