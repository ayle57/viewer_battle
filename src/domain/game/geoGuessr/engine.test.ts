import { describe, expect, it } from "vitest";
import { apply, availableActions, createInitialState, GEO_WIN_THRESHOLD } from "./engine";
import { toPublicView } from "./view";
import { sampleGeoPlaylist } from "./fixtures";
import type { GeoGuessrConfig, GeoGuessrState } from "./types";

function freshState(config: GeoGuessrConfig = sampleGeoPlaylist): GeoGuessrState {
  return createInitialState(config);
}

function mustOk(result: ReturnType<typeof apply>): GeoGuessrState {
  if (!result.ok) throw new Error(`expected ok, got error ${result.error.code}: ${result.error.message}`);
  return result.state;
}

/** A config with N identical rounds — enough to drive a team to GEO_WIN_THRESHOLD wins without running out of rounds. Distinct target per round so a fixed guess pair always resolves the same way, keeping the "first to N" tests deterministic. */
function manyRoundsConfig(count: number): GeoGuessrConfig {
  return {
    rounds: Array.from({ length: count }, (_, i) => ({
      id: `round-${i}`,
      imageUrl: `/images/maps/round-${i}.jpg`,
      question: `Where is spot ${i}?`,
      targetX: 0.5,
      targetY: 0.5,
    })),
  };
}

/** Team A guesses right on the target (distance 0), Team B guesses far away — Team A always wins the round this drives to reveal. */
function lockBothTeamsTeamAWins(state: GeoGuessrState): GeoGuessrState {
  let s = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_A", x: 0.5, y: 0.5 }));
  s = mustOk(apply(s, { type: "SET_GUESS", by: "TEAM_B", x: 0.0, y: 0.0 }));
  s = mustOk(apply(s, { type: "LOCK_GUESS", by: "TEAM_A" }));
  s = mustOk(apply(s, { type: "LOCK_GUESS", by: "TEAM_B" }));
  return s;
}

describe("createInitialState", () => {
  it("starts in_progress, guessing, zero scores, round 0, nothing locked", () => {
    const state = freshState();
    expect(state.status).toBe("in_progress");
    expect(state.phase).toBe("guessing");
    expect(state.currentRoundIndex).toBe(0);
    expect(state.scores).toEqual({ TEAM_A: 0, TEAM_B: 0 });
    expect(state.guesses).toEqual({ TEAM_A: null, TEAM_B: null });
    expect(state.lockedTeams).toEqual([]);
    expect(state.roundResult).toBeNull();
    expect(state.winner).toBeNull();
  });
});

describe("SET_GUESS", () => {
  it("records a team's guess without affecting the other team's", () => {
    const state = freshState();
    const next = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_A", x: 0.3, y: 0.4 }));
    expect(next.guesses.TEAM_A).toEqual({ x: 0.3, y: 0.4 });
    expect(next.guesses.TEAM_B).toBeNull();
  });

  it("does not mutate the input state", () => {
    const state = freshState();
    apply(state, { type: "SET_GUESS", by: "TEAM_A", x: 0.3, y: 0.4 });
    expect(state.guesses.TEAM_A).toBeNull();
  });

  it("can be changed freely before locking", () => {
    let state = freshState();
    state = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_A", x: 0.1, y: 0.1 }));
    state = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_A", x: 0.9, y: 0.9 }));
    expect(state.guesses.TEAM_A).toEqual({ x: 0.9, y: 0.9 });
  });

  it("rejects HOST and DISPLAY", () => {
    expect(!apply(freshState(), { type: "SET_GUESS", by: "HOST", x: 0.5, y: 0.5 }).ok).toBe(true);
    const result = apply(freshState(), { type: "SET_GUESS", by: "DISPLAY", x: 0.5, y: 0.5 });
    expect(!result.ok && result.error.code).toBe("FORBIDDEN_ROLE");
  });

  it("rejects out-of-range coordinates as INVALID_ACTION", () => {
    const result = apply(freshState(), { type: "SET_GUESS", by: "TEAM_A", x: 1.5, y: 0.5 });
    expect(!result.ok && result.error.code).toBe("INVALID_ACTION");
  });

  it("rejects a guess from a team that already locked", () => {
    let state = freshState();
    state = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_A", x: 0.5, y: 0.5 }));
    state = mustOk(apply(state, { type: "LOCK_GUESS", by: "TEAM_A" }));
    const result = apply(state, { type: "SET_GUESS", by: "TEAM_A", x: 0.1, y: 0.1 });
    expect(!result.ok && result.error.code).toBe("TEAM_ALREADY_LOCKED");
  });
});

describe("LOCK_GUESS", () => {
  it("rejects locking with no guess set (NO_GUESS_SET)", () => {
    const result = apply(freshState(), { type: "LOCK_GUESS", by: "TEAM_A" });
    expect(!result.ok && result.error.code).toBe("NO_GUESS_SET");
  });

  it("a single lock does not reveal — only lockedTeams changes, phase stays guessing", () => {
    let state = freshState();
    state = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_A", x: 0.5, y: 0.5 }));
    state = mustOk(apply(state, { type: "LOCK_GUESS", by: "TEAM_A" }));
    expect(state.phase).toBe("guessing");
    expect(state.lockedTeams).toEqual(["TEAM_A"]);
    expect(state.roundResult).toBeNull();
  });

  it("rejects a double lock from the same team", () => {
    let state = freshState();
    state = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_A", x: 0.5, y: 0.5 }));
    state = mustOk(apply(state, { type: "LOCK_GUESS", by: "TEAM_A" }));
    const result = apply(state, { type: "LOCK_GUESS", by: "TEAM_A" });
    expect(!result.ok && result.error.code).toBe("TEAM_ALREADY_LOCKED");
  });

  it("Team B can still freely change its guess after Team A locks", () => {
    let state = freshState();
    state = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_A", x: 0.5, y: 0.5 }));
    state = mustOk(apply(state, { type: "LOCK_GUESS", by: "TEAM_A" }));
    state = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_B", x: 0.1, y: 0.1 }));
    state = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_B", x: 0.2, y: 0.2 }));
    expect(state.guesses.TEAM_B).toEqual({ x: 0.2, y: 0.2 });
  });

  it("the second lock reveals: target, both guesses, distances, and the closer team wins the round", () => {
    let state = freshState();
    state = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_A", x: 0.5, y: 0.5 })); // exactly on target (0.5, 0.5)
    state = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_B", x: 0.0, y: 0.0 })); // far off
    state = mustOk(apply(state, { type: "LOCK_GUESS", by: "TEAM_A" }));
    const result = apply(state, { type: "LOCK_GUESS", by: "TEAM_B" });
    const next = mustOk(result);

    expect(next.phase).toBe("revealed");
    expect(next.roundResult).not.toBeNull();
    expect(next.roundResult!.targetX).toBe(0.5);
    expect(next.roundResult!.targetY).toBe(0.5);
    expect(next.roundResult!.distances.TEAM_A).toBe(0);
    expect(next.roundResult!.distances.TEAM_B).toBeCloseTo(Math.hypot(0.5, 0.5));
    expect(next.roundResult!.roundWinner).toBe("TEAM_A");
    expect(next.scores.TEAM_A).toBe(1);
    expect(next.scores.TEAM_B).toBe(0);
    expect(next.history).toHaveLength(1);

    expect(result.ok && result.events.map((e) => e.type)).toEqual(
      expect.arrayContaining(["TEAM_LOCKED", "ROUND_REVEALED", "SCORE_CHANGED"]),
    );
  });

  it("an exact distance tie awards the round with no score change to either team", () => {
    let state = freshState();
    state = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_A", x: 0.4, y: 0.5 }));
    state = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_B", x: 0.6, y: 0.5 })); // same distance from (0.5, 0.5)
    state = mustOk(apply(state, { type: "LOCK_GUESS", by: "TEAM_A" }));
    const next = mustOk(apply(state, { type: "LOCK_GUESS", by: "TEAM_B" }));
    expect(next.roundResult!.roundWinner).toBe("TIE");
    expect(next.scores).toEqual({ TEAM_A: 0, TEAM_B: 0 });
  });

  it("rejects LOCK_GUESS/SET_GUESS once the round is revealed (WRONG_PHASE)", () => {
    const revealed = lockBothTeamsTeamAWins(freshState());
    expect(!apply(revealed, { type: "SET_GUESS", by: "TEAM_A", x: 0.1, y: 0.1 }).ok).toBe(true);
    // Phase gate fires first, same ordering as every other action here —
    // "wrong phase" is checked before the more specific "already locked".
    const lockResult = apply(revealed, { type: "LOCK_GUESS", by: "TEAM_A" });
    expect(!lockResult.ok && lockResult.error.code).toBe("WRONG_PHASE");
  });
});

describe("NEXT_ROUND", () => {
  it("only the host may advance, and only once revealed", () => {
    const state = freshState();
    const tooEarly = apply(state, { type: "NEXT_ROUND", by: "HOST" });
    expect(!tooEarly.ok && tooEarly.error.code).toBe("WRONG_PHASE");

    const revealed = lockBothTeamsTeamAWins(state);
    const wrongRole = apply(revealed, { type: "NEXT_ROUND", by: "TEAM_A" });
    expect(!wrongRole.ok && wrongRole.error.code).toBe("FORBIDDEN_ROLE");
  });

  it("resets guesses/locks/roundResult and moves to the next round, guessing again", () => {
    const revealed = lockBothTeamsTeamAWins(freshState());
    const next = mustOk(apply(revealed, { type: "NEXT_ROUND", by: "HOST" }));
    expect(next.phase).toBe("guessing");
    expect(next.currentRoundIndex).toBe(1);
    expect(next.guesses).toEqual({ TEAM_A: null, TEAM_B: null });
    expect(next.lockedTeams).toEqual([]);
    expect(next.roundResult).toBeNull();
    // Score/history from round 0 are preserved, not reset.
    expect(next.scores.TEAM_A).toBe(1);
    expect(next.history).toHaveLength(1);
  });
});

describe("first-to-N and running out of rounds", () => {
  it(`finishes the game the instant a team reaches ${GEO_WIN_THRESHOLD} round wins, mid-board`, () => {
    let state = freshState(manyRoundsConfig(GEO_WIN_THRESHOLD + 3)); // plenty of rounds left over
    for (let i = 0; i < GEO_WIN_THRESHOLD; i++) {
      const revealed = lockBothTeamsTeamAWins(state);
      if (i < GEO_WIN_THRESHOLD - 1) {
        expect(revealed.status).toBe("in_progress");
        state = mustOk(apply(revealed, { type: "NEXT_ROUND", by: "HOST" }));
      } else {
        state = revealed;
      }
    }
    expect(state.status).toBe("finished");
    expect(state.winner).toBe("TEAM_A");
    expect(state.scores.TEAM_A).toBe(GEO_WIN_THRESHOLD);
    // No further actions accepted once finished.
    const after = apply(state, { type: "NEXT_ROUND", by: "HOST" });
    expect(!after.ok && after.error.code).toBe("GAME_ALREADY_FINISHED");
  });

  it("finishes with the leading team as winner once every configured round is played, even under the threshold", () => {
    let state = freshState(manyRoundsConfig(2)); // fewer rounds than GEO_WIN_THRESHOLD
    state = lockBothTeamsTeamAWins(state); // round 0: TEAM_A wins
    expect(state.status).toBe("in_progress");
    state = mustOk(apply(state, { type: "NEXT_ROUND", by: "HOST" }));
    state = lockBothTeamsTeamAWins(state); // round 1 (last): TEAM_A wins again
    expect(state.status).toBe("finished");
    expect(state.winner).toBe("TEAM_A");
    expect(state.scores.TEAM_A).toBe(2);
  });

  it("finishes as a TIE if the rounds run out with equal scores", () => {
    let state = freshState(manyRoundsConfig(2));
    state = lockBothTeamsTeamAWins(state); // TEAM_A wins round 0
    state = mustOk(apply(state, { type: "NEXT_ROUND", by: "HOST" }));
    // Round 1: swap who guesses correctly so TEAM_B wins it, leveling the score.
    let s = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_B", x: 0.5, y: 0.5 }));
    s = mustOk(apply(s, { type: "SET_GUESS", by: "TEAM_A", x: 0.0, y: 0.0 }));
    s = mustOk(apply(s, { type: "LOCK_GUESS", by: "TEAM_A" }));
    s = mustOk(apply(s, { type: "LOCK_GUESS", by: "TEAM_B" }));
    expect(s.status).toBe("finished");
    expect(s.winner).toBe("TIE");
    expect(s.scores).toEqual({ TEAM_A: 1, TEAM_B: 1 });
  });
});

describe("END_GAME", () => {
  it("host-only, ends immediately with the current leader as winner", () => {
    let state = freshState();
    state = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_A", x: 0.5, y: 0.5 }));
    const wrongRole = apply(state, { type: "END_GAME", by: "TEAM_A" });
    expect(!wrongRole.ok && wrongRole.error.code).toBe("FORBIDDEN_ROLE");

    const revealed = lockBothTeamsTeamAWins(freshState()); // TEAM_A leads 1-0
    const ended = mustOk(apply(revealed, { type: "END_GAME", by: "HOST" }));
    expect(ended.status).toBe("finished");
    expect(ended.winner).toBe("TEAM_A");
  });

  it("ties (0-0) end in TIE", () => {
    const ended = mustOk(apply(freshState(), { type: "END_GAME", by: "HOST" }));
    expect(ended.status).toBe("finished");
    expect(ended.winner).toBe("TIE");
  });
});

describe("availableActions", () => {
  it("HOST can END_GAME any time, plus NEXT_ROUND once revealed", () => {
    expect(availableActions(freshState(), "HOST")).toEqual(["END_GAME"]);
    const revealed = lockBothTeamsTeamAWins(freshState());
    expect(availableActions(revealed, "HOST")).toEqual(["NEXT_ROUND", "END_GAME"]);
  });

  it("a team sees SET_GUESS only, then both, once it has a guess; nothing once locked", () => {
    let state = freshState();
    expect(availableActions(state, "TEAM_A")).toEqual(["SET_GUESS"]);
    state = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_A", x: 0.5, y: 0.5 }));
    expect(availableActions(state, "TEAM_A")).toEqual(["SET_GUESS", "LOCK_GUESS"]);
    state = mustOk(apply(state, { type: "LOCK_GUESS", by: "TEAM_A" }));
    expect(availableActions(state, "TEAM_A")).toEqual([]);
  });

  it("DISPLAY can never act", () => {
    expect(availableActions(freshState(), "DISPLAY")).toEqual([]);
  });

  it("nothing once finished", () => {
    const ended = mustOk(apply(freshState(), { type: "END_GAME", by: "HOST" }));
    expect(availableActions(ended, "HOST")).toEqual([]);
    expect(availableActions(ended, "TEAM_A")).toEqual([]);
  });
});

describe("toPublicView — the private ping (this engine's core guarantee)", () => {
  it("HOST sees both teams' live guesses and the real target", () => {
    let state = freshState();
    state = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_A", x: 0.3, y: 0.3 }));
    state = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_B", x: 0.7, y: 0.7 }));
    const hostView = toPublicView(state, "HOST");
    expect(hostView.guesses.TEAM_A).toEqual({ x: 0.3, y: 0.3 });
    expect(hostView.guesses.TEAM_B).toEqual({ x: 0.7, y: 0.7 });
    expect(hostView.rounds[0]!.targetX).toBe(0.5);
  });

  it("TEAM_A sees its own live guess but never TEAM_B's, and the target stays hidden, before reveal", () => {
    let state = freshState();
    state = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_A", x: 0.3, y: 0.3 }));
    state = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_B", x: 0.7, y: 0.7 }));

    const teamAView = toPublicView(state, "TEAM_A");
    expect(teamAView.guesses.TEAM_A).toEqual({ x: 0.3, y: 0.3 });
    expect(teamAView.guesses.TEAM_B).toBeNull();
    expect(teamAView.rounds[0]!.targetX).toBeNull();
    expect(teamAView.rounds[0]!.targetY).toBeNull();
    // But the image AND question are visible — you have to know what
    // you're looking for, and be able to see the map, to play at all.
    expect(teamAView.rounds[0]!.imageUrl).toBe(sampleGeoPlaylist.rounds[0]!.imageUrl);
    expect(teamAView.rounds[0]!.question).toBe(sampleGeoPlaylist.rounds[0]!.question);

    const teamBView = toPublicView(state, "TEAM_B");
    expect(teamBView.guesses.TEAM_B).toEqual({ x: 0.7, y: 0.7 });
    expect(teamBView.guesses.TEAM_A).toBeNull();
  });

  it("DISPLAY never sees either team's live guess before reveal", () => {
    let state = freshState();
    state = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_A", x: 0.3, y: 0.3 }));
    state = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_B", x: 0.7, y: 0.7 }));
    const displayView = toPublicView(state, "DISPLAY");
    expect(displayView.guesses.TEAM_A).toBeNull();
    expect(displayView.guesses.TEAM_B).toBeNull();
    expect(displayView.rounds[0]!.targetX).toBeNull();
  });

  it("once revealed, everyone (including DISPLAY) sees both guesses and the real target", () => {
    const revealed = lockBothTeamsTeamAWins(freshState());
    for (const role of ["TEAM_A", "TEAM_B", "DISPLAY"] as const) {
      const view = toPublicView(revealed, role);
      expect(view.guesses.TEAM_A).toEqual({ x: 0.5, y: 0.5 });
      expect(view.guesses.TEAM_B).toEqual({ x: 0.0, y: 0.0 });
      expect(view.rounds[0]!.targetX).toBe(0.5);
    }
  });

  it("a future round's image/question/title/target are fully blanked (no reading ahead)", () => {
    const revealed = lockBothTeamsTeamAWins(freshState()); // round 0 revealed, round 1 not yet reached
    const view = toPublicView(revealed, "TEAM_A");
    expect(view.rounds[1]!.imageUrl).toBe("");
    expect(view.rounds[1]!.question).toBe("");
    expect(view.rounds[1]!.targetX).toBeNull();
    expect(view.rounds[1]!.title).toBe("");
  });

  it("a played (history) round stays fully visible after the game moves past it", () => {
    let state = lockBothTeamsTeamAWins(freshState());
    state = mustOk(apply(state, { type: "NEXT_ROUND", by: "HOST" }));
    const view = toPublicView(state, "TEAM_A");
    expect(view.rounds[0]!.targetX).toBe(0.5); // round 0, now history, still visible
    expect(view.rounds[1]!.targetX).toBeNull(); // round 1, current, still guessing
  });
});
