import { describe, expect, it } from "vitest";
import { apply, availableActions, checkExpiry, createInitialState, GEO_WIN_THRESHOLD } from "./engine";
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

/** Team A proposes-and-locks exactly on the target (distance 0), Team B proposes-and-locks far away — Team A always wins the round this drives to reveal. Each team has exactly ONE proposal, so `proposalIndex: 0` always means "the only thing on the table." */
function lockBothTeamsTeamAWins(state: GeoGuessrState): GeoGuessrState {
  let s = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_A", byName: "P", x: 0.5, y: 0.5 }));
  s = mustOk(apply(s, { type: "SET_GUESS", by: "TEAM_B", byName: "P", x: 0.0, y: 0.0 }));
  s = mustOk(apply(s, { type: "LOCK_GUESS", by: "TEAM_A", proposalIndex: 0 }));
  s = mustOk(apply(s, { type: "LOCK_GUESS", by: "TEAM_B", proposalIndex: 0 }));
  return s;
}

describe("createInitialState", () => {
  it("starts in_progress, guessing, zero scores, round 0, nothing proposed or locked", () => {
    const state = freshState();
    expect(state.status).toBe("in_progress");
    expect(state.phase).toBe("guessing");
    expect(state.currentRoundIndex).toBe(0);
    expect(state.scores).toEqual({ TEAM_A: 0, TEAM_B: 0 });
    expect(state.proposals).toEqual({ TEAM_A: [], TEAM_B: [] });
    expect(state.guesses).toEqual({ TEAM_A: null, TEAM_B: null });
    expect(state.lockedTeams).toEqual([]);
    expect(state.roundResult).toBeNull();
    expect(state.winner).toBeNull();
  });
});

describe("SET_GUESS — proposing a candidate spot", () => {
  it("appends to the team's own proposals without affecting the other team's, and never touches guesses (that's LOCK_GUESS's job)", () => {
    const state = freshState();
    const next = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_A", byName: "P", x: 0.3, y: 0.4 }));
    expect(next.proposals.TEAM_A).toEqual([{ x: 0.3, y: 0.4, byName: "P" }]);
    expect(next.proposals.TEAM_B).toEqual([]);
    expect(next.guesses.TEAM_A).toBeNull();
  });

  it("does not mutate the input state", () => {
    const state = freshState();
    apply(state, { type: "SET_GUESS", by: "TEAM_A", byName: "P", x: 0.3, y: 0.4 });
    expect(state.proposals.TEAM_A).toEqual([]);
  });

  it("a proposal from a GENUINELY DIFFERENT teammate ADDS a second candidate — it does not replace the first (two teammates, two pins)", () => {
    let state = freshState();
    state = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_A", byName: "Alice", x: 0.1, y: 0.1 }));
    state = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_A", byName: "Bob", x: 0.9, y: 0.9 }));
    expect(state.proposals.TEAM_A).toEqual([
      { x: 0.1, y: 0.1, byName: "Alice" },
      { x: 0.9, y: 0.9, byName: "Bob" },
    ]);
  });

  it("a SECOND tap from the SAME player REPLACES their own proposal in place — never a second pin of their own (real, reported bug: 'je peux avoir deux pings pour un joueur, c'est un ping par joueur')", () => {
    let state = freshState();
    state = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_A", byName: "Alice", x: 0.1, y: 0.1 }));
    state = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_A", byName: "Alice", x: 0.9, y: 0.9 })); // Alice changed her mind
    expect(state.proposals.TEAM_A).toEqual([{ x: 0.9, y: 0.9, byName: "Alice" }]); // one entry, moved — not two
  });

  it("a teammate replacing their own proposal never disturbs the OTHER teammate's still-open one", () => {
    let state = freshState();
    state = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_A", byName: "Alice", x: 0.1, y: 0.1 }));
    state = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_A", byName: "Bob", x: 0.5, y: 0.5 }));
    state = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_A", byName: "Alice", x: 0.9, y: 0.9 })); // Alice moves hers
    expect(state.proposals.TEAM_A).toEqual([
      { x: 0.9, y: 0.9, byName: "Alice" }, // moved in place, still index 0 — not appended at the end
      { x: 0.5, y: 0.5, byName: "Bob" }, // Bob's own proposal, completely untouched
    ]);
  });

  it("caps at MAX_PLAYERS_PER_TEAM proposals, dropping the oldest first — a defensive fallback for a THIRD distinct player (e.g. one who left mid-round), not the common path", () => {
    let state = freshState();
    state = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_A", byName: "Alice", x: 0.1, y: 0.1 }));
    state = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_A", byName: "Bob", x: 0.2, y: 0.2 }));
    state = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_A", byName: "Cara", x: 0.3, y: 0.3 }));
    // MAX_PLAYERS_PER_TEAM is 2 — Alice's (0.1, 0.1) fell off.
    expect(state.proposals.TEAM_A).toEqual([
      { x: 0.2, y: 0.2, byName: "Bob" },
      { x: 0.3, y: 0.3, byName: "Cara" },
    ]);
  });

  it("rejects HOST and DISPLAY", () => {
    expect(!apply(freshState(), { type: "SET_GUESS", by: "HOST", byName: "P", x: 0.5, y: 0.5 }).ok).toBe(true);
    const result = apply(freshState(), { type: "SET_GUESS", by: "DISPLAY", byName: "P", x: 0.5, y: 0.5 });
    expect(!result.ok && result.error.code).toBe("FORBIDDEN_ROLE");
  });

  it("rejects out-of-range coordinates as INVALID_ACTION", () => {
    const result = apply(freshState(), { type: "SET_GUESS", by: "TEAM_A", byName: "P", x: 1.5, y: 0.5 });
    expect(!result.ok && result.error.code).toBe("INVALID_ACTION");
  });

  it("rejects a proposal from a team that already locked", () => {
    let state = freshState();
    state = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_A", byName: "P", x: 0.5, y: 0.5 }));
    state = mustOk(apply(state, { type: "LOCK_GUESS", by: "TEAM_A", proposalIndex: 0 }));
    const result = apply(state, { type: "SET_GUESS", by: "TEAM_A", byName: "P", x: 0.1, y: 0.1 });
    expect(!result.ok && result.error.code).toBe("TEAM_ALREADY_LOCKED");
  });
});

describe("LOCK_GUESS — finalizing one specific proposal", () => {
  it("rejects locking with nothing proposed yet (NO_GUESS_SET)", () => {
    const result = apply(freshState(), { type: "LOCK_GUESS", by: "TEAM_A", proposalIndex: 0 });
    expect(!result.ok && result.error.code).toBe("NO_GUESS_SET");
  });

  it("rejects an out-of-range proposalIndex the same way as no proposal at all", () => {
    const state = mustOk(apply(freshState(), { type: "SET_GUESS", by: "TEAM_A", byName: "P", x: 0.5, y: 0.5 })); // only index 0 exists
    const result = apply(state, { type: "LOCK_GUESS", by: "TEAM_A", proposalIndex: 1 });
    expect(!result.ok && result.error.code).toBe("NO_GUESS_SET");
  });

  it("a single lock does not reveal — only lockedTeams and this team's own guesses entry change, phase stays guessing", () => {
    let state = freshState();
    state = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_A", byName: "P", x: 0.5, y: 0.5 }));
    state = mustOk(apply(state, { type: "LOCK_GUESS", by: "TEAM_A", proposalIndex: 0 }));
    expect(state.phase).toBe("guessing");
    expect(state.lockedTeams).toEqual(["TEAM_A"]);
    expect(state.guesses.TEAM_A).toEqual({ x: 0.5, y: 0.5 });
    expect(state.roundResult).toBeNull();
  });

  it("rejects a double lock from the same team", () => {
    let state = freshState();
    state = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_A", byName: "P", x: 0.5, y: 0.5 }));
    state = mustOk(apply(state, { type: "LOCK_GUESS", by: "TEAM_A", proposalIndex: 0 }));
    const result = apply(state, { type: "LOCK_GUESS", by: "TEAM_A", proposalIndex: 0 });
    expect(!result.ok && result.error.code).toBe("TEAM_ALREADY_LOCKED");
  });

  it("Team B can still freely add MORE proposals after Team A locks", () => {
    let state = freshState();
    state = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_A", byName: "P", x: 0.5, y: 0.5 }));
    state = mustOk(apply(state, { type: "LOCK_GUESS", by: "TEAM_A", proposalIndex: 0 }));
    state = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_B", byName: "Alice", x: 0.1, y: 0.1 }));
    state = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_B", byName: "Bob", x: 0.2, y: 0.2 }));
    expect(state.proposals.TEAM_B).toEqual([
      { x: 0.1, y: 0.1, byName: "Alice" },
      { x: 0.2, y: 0.2, byName: "Bob" },
    ]);
  });

  it("any teammate may lock ANY proposal, not only the first one — the Game Kernel has no notion of which player placed which", () => {
    let state = freshState();
    state = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_A", byName: "Alice", x: 0.1, y: 0.1 })); // index 0 — a bad guess
    state = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_A", byName: "Bob", x: 0.5, y: 0.5 })); // index 1 — the good one, exactly on target
    state = mustOk(apply(state, { type: "LOCK_GUESS", by: "TEAM_A", proposalIndex: 1 })); // lock the SECOND proposal, not the first
    expect(state.guesses.TEAM_A).toEqual({ x: 0.5, y: 0.5 });
  });

  it("the second lock reveals: target, both guesses, distances, and the closer team wins the round", () => {
    let state = freshState();
    state = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_A", byName: "P", x: 0.5, y: 0.5 })); // exactly on target (0.5, 0.5)
    state = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_B", byName: "P", x: 0.0, y: 0.0 })); // far off
    state = mustOk(apply(state, { type: "LOCK_GUESS", by: "TEAM_A", proposalIndex: 0 }));
    const result = apply(state, { type: "LOCK_GUESS", by: "TEAM_B", proposalIndex: 0 });
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

  it("LOCK_GUESS strips the proposal's byName — guesses/roundResult stay player-identity-free, only the still-open proposals list ever carries a name", () => {
    let state = freshState();
    state = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_A", byName: "Alice", x: 0.5, y: 0.5 }));
    state = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_B", byName: "Bob", x: 0.0, y: 0.0 }));
    // Sanity: the proposal itself DOES carry byName before it's locked.
    expect(state.proposals.TEAM_A[0]).toEqual({ x: 0.5, y: 0.5, byName: "Alice" });

    state = mustOk(apply(state, { type: "LOCK_GUESS", by: "TEAM_A", proposalIndex: 0 }));
    expect(state.guesses.TEAM_A).toEqual({ x: 0.5, y: 0.5 }); // no byName
    expect(Object.keys(state.guesses.TEAM_A!)).not.toContain("byName");

    const revealed = mustOk(apply(state, { type: "LOCK_GUESS", by: "TEAM_B", proposalIndex: 0 }));
    expect(revealed.roundResult!.guesses.TEAM_A).toEqual({ x: 0.5, y: 0.5 });
    expect(revealed.roundResult!.guesses.TEAM_B).toEqual({ x: 0.0, y: 0.0 });
    expect(Object.keys(revealed.roundResult!.guesses.TEAM_A!)).not.toContain("byName");
  });

  it("an exact distance tie awards the round with no score change to either team", () => {
    let state = freshState();
    state = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_A", byName: "P", x: 0.4, y: 0.5 }));
    state = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_B", byName: "P", x: 0.6, y: 0.5 })); // same distance from (0.5, 0.5)
    state = mustOk(apply(state, { type: "LOCK_GUESS", by: "TEAM_A", proposalIndex: 0 }));
    const next = mustOk(apply(state, { type: "LOCK_GUESS", by: "TEAM_B", proposalIndex: 0 }));
    expect(next.roundResult!.roundWinner).toBe("TIE");
    expect(next.scores).toEqual({ TEAM_A: 0, TEAM_B: 0 });
  });

  it("rejects LOCK_GUESS/SET_GUESS once the round is revealed (WRONG_PHASE)", () => {
    const revealed = lockBothTeamsTeamAWins(freshState());
    expect(!apply(revealed, { type: "SET_GUESS", by: "TEAM_A", byName: "P", x: 0.1, y: 0.1 }).ok).toBe(true);
    // Phase gate fires first, same ordering as every other action here —
    // "wrong phase" is checked before the more specific "already locked".
    const lockResult = apply(revealed, { type: "LOCK_GUESS", by: "TEAM_A", proposalIndex: 0 });
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

  it("resets proposals/guesses/locks/roundResult and moves to the next round, guessing again", () => {
    const revealed = lockBothTeamsTeamAWins(freshState());
    const next = mustOk(apply(revealed, { type: "NEXT_ROUND", by: "HOST" }));
    expect(next.phase).toBe("guessing");
    expect(next.currentRoundIndex).toBe(1);
    expect(next.proposals).toEqual({ TEAM_A: [], TEAM_B: [] });
    expect(next.guesses).toEqual({ TEAM_A: null, TEAM_B: null });
    expect(next.lockedTeams).toEqual([]);
    expect(next.roundResult).toBeNull();
    // Score/history from round 0 are preserved, not reset.
    expect(next.scores.TEAM_A).toBe(1);
    expect(next.history).toHaveLength(1);
  });
});

describe("SKIP_ROUND", () => {
  it("only the host may skip, and only during guessing", () => {
    const revealed = lockBothTeamsTeamAWins(freshState());
    const tooLate = apply(revealed, { type: "SKIP_ROUND", by: "HOST" });
    expect(!tooLate.ok && tooLate.error.code).toBe("WRONG_PHASE");

    const wrongRole = apply(freshState(), { type: "SKIP_ROUND", by: "TEAM_A" });
    expect(!wrongRole.ok && wrongRole.error.code).toBe("FORBIDDEN_ROLE");
  });

  it("reveals the round as a TIE with no guesses and no score change", () => {
    const state = freshState();
    const next = mustOk(apply(state, { type: "SKIP_ROUND", by: "HOST" }));
    expect(next.phase).toBe("revealed");
    expect(next.guesses).toEqual({ TEAM_A: null, TEAM_B: null });
    expect(next.roundResult).toEqual({
      roundIndex: 0,
      targetX: sampleGeoPlaylist.rounds[0]!.targetX,
      targetY: sampleGeoPlaylist.rounds[0]!.targetY,
      guesses: { TEAM_A: null, TEAM_B: null },
      distances: { TEAM_A: null, TEAM_B: null },
      roundWinner: "TIE",
    });
    expect(next.scores).toEqual({ TEAM_A: 0, TEAM_B: 0 });
  });

  it("discards an already-locked guess too — a skip throws the whole round out", () => {
    let state = mustOk(apply(freshState(), { type: "SET_GUESS", by: "TEAM_A", byName: "P", x: 0.5, y: 0.5 }));
    state = mustOk(apply(state, { type: "LOCK_GUESS", by: "TEAM_A", proposalIndex: 0 }));
    const next = mustOk(apply(state, { type: "SKIP_ROUND", by: "HOST" }));
    expect(next.guesses.TEAM_A).toBeNull();
    expect(next.lockedTeams).toEqual([]);
  });

  it("cancels a running countdown", () => {
    let state = mustOk(apply(freshState(), { type: "START_COUNTDOWN", by: "HOST", durationMs: 30_000, nowMs: 0 }));
    const result = apply(state, { type: "SKIP_ROUND", by: "HOST" });
    const next = mustOk(result);
    expect(next.countdownDeadline).toBeNull();
    expect(result.ok && result.events.map((e) => e.type)).toContain("COUNTDOWN_CANCELLED");
  });

  it("moves to the next round via NEXT_ROUND exactly like a real reveal — no score, no winner for this round", () => {
    const skipped = mustOk(apply(freshState(manyRoundsConfig(2)), { type: "SKIP_ROUND", by: "HOST" }));
    const next = mustOk(apply(skipped, { type: "NEXT_ROUND", by: "HOST" }));
    expect(next.phase).toBe("guessing");
    expect(next.currentRoundIndex).toBe(1);
  });

  it("skipping the last round finishes the game gracefully (highest score wins)", () => {
    const state = freshState(manyRoundsConfig(1));
    const next = mustOk(apply(state, { type: "SKIP_ROUND", by: "HOST" }));
    expect(next.status).toBe("finished");
    expect(next.winner).toBe("TIE"); // 0-0
    expect(next.phase).toBe("revealed"); // the skip's own reveal stays visible, same as a real last-round finish
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
    let s = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_B", byName: "P", x: 0.5, y: 0.5 }));
    s = mustOk(apply(s, { type: "SET_GUESS", by: "TEAM_A", byName: "P", x: 0.0, y: 0.0 }));
    s = mustOk(apply(s, { type: "LOCK_GUESS", by: "TEAM_A", proposalIndex: 0 }));
    s = mustOk(apply(s, { type: "LOCK_GUESS", by: "TEAM_B", proposalIndex: 0 }));
    expect(s.status).toBe("finished");
    expect(s.winner).toBe("TIE");
    expect(s.scores).toEqual({ TEAM_A: 1, TEAM_B: 1 });
  });
});

describe("END_GAME", () => {
  it("host-only, ends immediately with the current leader as winner", () => {
    let state = freshState();
    state = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_A", byName: "P", x: 0.5, y: 0.5 }));
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

describe("START_COUNTDOWN / CANCEL_COUNTDOWN / checkExpiry — the Host countdown-to-end feature", () => {
  it("host-only; sets countdownDeadline to nowMs + durationMs, a plain deterministic sum", () => {
    const wrongRole = apply(freshState(), { type: "START_COUNTDOWN", by: "TEAM_A", durationMs: 10_000, nowMs: 1_000 });
    expect(!wrongRole.ok && wrongRole.error.code).toBe("FORBIDDEN_ROLE");

    const state = mustOk(apply(freshState(), { type: "START_COUNTDOWN", by: "HOST", durationMs: 10_000, nowMs: 1_000 }));
    expect(state.countdownDeadline).toBe(11_000);
  });

  it("rejects a duration outside the fixed 10s/30s/60s set (INVALID_ACTION) — not an arbitrary number", () => {
    // `durationMs: 45_000` doesn't type-check against the fixed literal
    // union (by design — see startCountdownActionSchema's own doc
    // comment) — cast past that, same as any other test proving RUNTIME
    // (zod) rejection of a shape an untrusted JSON payload could still
    // send even though the static type forbids it.
    const result = apply(freshState(), { type: "START_COUNTDOWN", by: "HOST", durationMs: 45_000, nowMs: 0 } as unknown as Parameters<typeof apply>[1]);
    expect(!result.ok && result.error.code).toBe("INVALID_ACTION");
  });

  it("starting a SECOND countdown retargets (replaces) the deadline — no need to cancel first", () => {
    let state = mustOk(apply(freshState(), { type: "START_COUNTDOWN", by: "HOST", durationMs: 60_000, nowMs: 0 }));
    expect(state.countdownDeadline).toBe(60_000);
    state = mustOk(apply(state, { type: "START_COUNTDOWN", by: "HOST", durationMs: 10_000, nowMs: 5_000 }));
    expect(state.countdownDeadline).toBe(15_000); // the NEW deadline, not a sum/extension of the old one
  });

  it("legal in ANY phase — same posture as END_GAME, since it's just a delayed one", () => {
    let state = mustOk(apply(freshState(), { type: "SET_GUESS", by: "TEAM_A", byName: "P", x: 0.5, y: 0.5 }));
    state = mustOk(apply(state, { type: "START_COUNTDOWN", by: "HOST", durationMs: 10_000, nowMs: 0 }));
    expect(state.countdownDeadline).toBe(10_000);

    const revealed = lockBothTeamsTeamAWins(freshState());
    const withCountdown = mustOk(apply(revealed, { type: "START_COUNTDOWN", by: "HOST", durationMs: 30_000, nowMs: 0 }));
    expect(withCountdown.countdownDeadline).toBe(30_000);
  });

  it("CANCEL_COUNTDOWN clears the deadline; errors NO_COUNTDOWN_ACTIVE if none is running", () => {
    const noCountdown = apply(freshState(), { type: "CANCEL_COUNTDOWN", by: "HOST" });
    expect(!noCountdown.ok && noCountdown.error.code).toBe("NO_COUNTDOWN_ACTIVE");

    const wrongRole = apply(freshState(), { type: "CANCEL_COUNTDOWN", by: "TEAM_A" });
    expect(!wrongRole.ok && wrongRole.error.code).toBe("FORBIDDEN_ROLE");

    const started = mustOk(apply(freshState(), { type: "START_COUNTDOWN", by: "HOST", durationMs: 10_000, nowMs: 0 }));
    const cancelled = mustOk(apply(started, { type: "CANCEL_COUNTDOWN", by: "HOST" }));
    expect(cancelled.countdownDeadline).toBeNull();
  });

  it("checkExpiry: null (nothing to do) with no countdown running, or before the deadline", () => {
    const noCountdown = freshState();
    expect(checkExpiry(noCountdown, 999_999)).toBeNull();

    const started = mustOk(apply(freshState(), { type: "START_COUNTDOWN", by: "HOST", durationMs: 10_000, nowMs: 0 })); // deadline = 10_000
    expect(checkExpiry(started, 9_999)).toBeNull(); // one ms early — still nothing to do
  });

  it("checkExpiry never resolves an already-finished game (null, not a second finish)", () => {
    const ended = mustOk(apply(freshState(), { type: "END_GAME", by: "HOST" }));
    expect(checkExpiry(ended, 999_999_999)).toBeNull();
  });

  it("NEXT_ROUND (manual advance) clears any running countdown — a fresh round always starts countdown-free, the Host starts a new one if they want one", () => {
    let state = mustOk(apply(freshState(), { type: "START_COUNTDOWN", by: "HOST", durationMs: 60_000, nowMs: 0 }));
    state = lockBothTeamsTeamAWins(state);
    state = mustOk(apply(state, { type: "NEXT_ROUND", by: "HOST" }));
    expect(state.countdownDeadline).toBeNull();
  });

  it("END_GAME (the ordinary Host action) clears any running countdown too — a finished game never shows a stale one", () => {
    const started = mustOk(apply(freshState(), { type: "START_COUNTDOWN", by: "HOST", durationMs: 60_000, nowMs: 0 }));
    const ended = mustOk(apply(started, { type: "END_GAME", by: "HOST" }));
    expect(ended.countdownDeadline).toBeNull();
  });

  it("a natural finish (both teams lock the last round) clears a running countdown too", () => {
    let state = mustOk(apply(freshState(), { type: "START_COUNTDOWN", by: "HOST", durationMs: 60_000, nowMs: 0 }));
    state = lockBothTeamsTeamAWins(state); // round 1
    state = mustOk(apply(state, { type: "NEXT_ROUND", by: "HOST" }));
    state = lockBothTeamsTeamAWins(state); // round 2 — sampleGeoPlaylist has exactly 2, so this finishes the game naturally
    expect(state.status).toBe("finished");
    expect(state.countdownDeadline).toBeNull();
  });
});

/**
 * The REVISED countdown-expiry semantics — the actual product ask this
 * closes: "le compteur du round fini le round et nous envoie au
 * prochain round [...] si c'est le dernier alors ça finit le jeu."
 * Exercises both COUNTDOWN_EXPIRED (the real action the server
 * dispatches — src/server/sockets/game.ts) and `checkExpiry` (the pure
 * self-heal path) — both funnel through the identical
 * `resolveExpiredCountdown` internally, so proving one is really proving
 * the shared logic underneath, but both entry points get at least one
 * direct test so a regression in either wiring is caught.
 */
describe("COUNTDOWN_EXPIRED / checkExpiry — the round-forcing semantics (not 'always ends the game')", () => {
  it("on a NON-last round with nobody locked and nobody even proposing: force-closes the round with no winner, and genuinely advances to the next round — no NEXT_ROUND click required", () => {
    const state = mustOk(apply(freshState(manyRoundsConfig(2)), { type: "START_COUNTDOWN", by: "HOST", durationMs: 10_000, nowMs: 0 }));
    const expired = checkExpiry(state, 10_000)!;
    expect(expired.status).toBe("in_progress"); // NOT finished — round 1 of 2, more left to play
    expect(expired.phase).toBe("guessing"); // fresh round 2, ready to play immediately
    expect(expired.currentRoundIndex).toBe(1);
    expect(expired.roundResult).toBeNull(); // reset for the new round
    expect(expired.countdownDeadline).toBeNull(); // a fresh round always starts countdown-free
    expect(expired.scores).toEqual({ TEAM_A: 0, TEAM_B: 0 }); // nobody answered round 1 at all — no score change
  });

  it("auto-locks whichever proposal each still-open team has queued, then reveals and scores it exactly like a real LOCK_GUESS would", () => {
    let state = mustOk(apply(freshState(manyRoundsConfig(2)), { type: "SET_GUESS", by: "TEAM_A", byName: "P", x: 0.5, y: 0.5 })); // dead on target, proposed but never locked
    state = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_B", byName: "P", x: 0.0, y: 0.0 })); // far off, also never locked
    state = mustOk(apply(state, { type: "START_COUNTDOWN", by: "HOST", durationMs: 10_000, nowMs: 0 }));

    const expired = checkExpiry(state, 10_000)!;
    expect(expired.currentRoundIndex).toBe(1); // advanced — round 1's own history is what we check below
    const result = expired.history[0]!;
    expect(result.guesses.TEAM_A).toEqual({ x: 0.5, y: 0.5 }); // the queued proposal, auto-locked
    expect(result.guesses.TEAM_B).toEqual({ x: 0.0, y: 0.0 });
    expect(result.roundWinner).toBe("TEAM_A"); // dead on target beats far off, same math as an ordinary reveal
    expect(expired.scores).toEqual({ TEAM_A: 1, TEAM_B: 0 });
  });

  it("a team with ZERO proposals queued gets a real null guess — an automatic loss to a team that had anything at all", () => {
    const state = mustOk(
      apply(mustOk(apply(freshState(manyRoundsConfig(1)), { type: "SET_GUESS", by: "TEAM_A", byName: "P", x: 0.5, y: 0.5 })), {
        type: "START_COUNTDOWN",
        by: "HOST",
        durationMs: 10_000,
        nowMs: 0,
      }),
    ); // TEAM_B never proposes anything at all this round
    const expired = checkExpiry(state, 10_000)!;
    expect(expired.status).toBe("finished"); // manyRoundsConfig(1) — this WAS the last (only) round
    expect(expired.roundResult!.guesses.TEAM_A).toEqual({ x: 0.5, y: 0.5 });
    expect(expired.roundResult!.guesses.TEAM_B).toBeNull(); // genuinely never answered
    expect(expired.roundResult!.distances.TEAM_B).toBeNull();
    expect(expired.roundResult!.roundWinner).toBe("TEAM_A");
    expect(expired.winner).toBe("TEAM_A");
  });

  it("neither team proposes anything at all: the round is a real TIE, no score change, still advances/finishes normally", () => {
    const state = mustOk(apply(freshState(manyRoundsConfig(1)), { type: "START_COUNTDOWN", by: "HOST", durationMs: 10_000, nowMs: 0 }));
    const expired = checkExpiry(state, 10_000)!;
    expect(expired.status).toBe("finished");
    expect(expired.winner).toBe("TIE");
    expect(expired.roundResult!.guesses).toEqual({ TEAM_A: null, TEAM_B: null });
    expect(expired.roundResult!.roundWinner).toBe("TIE");
  });

  it("expiring on the LAST round finishes the whole game — same winner rule as END_GAME/a natural last-round finish", () => {
    const state = mustOk(apply(freshState(manyRoundsConfig(1)), { type: "START_COUNTDOWN", by: "HOST", durationMs: 10_000, nowMs: 0 }));
    const expired = checkExpiry(state, 10_000)!;
    expect(expired.status).toBe("finished");
    expect(expired.winner).toBe("TIE"); // 0-0, nobody answered
    expect(expired.countdownDeadline).toBeNull();
  });

  it("expiring while ALREADY revealed (both teams locked naturally before the deadline) just advances/finishes — no forced-lock needed, nothing double-counted", () => {
    let state = mustOk(apply(freshState(manyRoundsConfig(2)), { type: "START_COUNTDOWN", by: "HOST", durationMs: 60_000, nowMs: 0 }));
    state = lockBothTeamsTeamAWins(state); // both lock well before the deadline — countdown deliberately survives this (types.ts's own doc comment)
    expect(state.phase).toBe("revealed");
    expect(state.scores).toEqual({ TEAM_A: 1, TEAM_B: 0 });

    const expired = checkExpiry(state, 60_000)!;
    expect(expired.currentRoundIndex).toBe(1); // advanced to round 2
    expect(expired.phase).toBe("guessing");
    expect(expired.scores).toEqual({ TEAM_A: 1, TEAM_B: 0 }); // round 1's real score UNCHANGED — not re-scored a second time
  });

  it("reaching GEO_WIN_THRESHOLD via a forced reveal finishes the game even with rounds still left", () => {
    // Win 5 rounds for real, then force-close the 6th (last needed, not
    // last available) via the countdown.
    let state = freshState(manyRoundsConfig(10));
    for (let i = 0; i < GEO_WIN_THRESHOLD - 1; i++) {
      state = lockBothTeamsTeamAWins(state);
      state = mustOk(apply(state, { type: "NEXT_ROUND", by: "HOST" }));
    }
    expect(state.scores.TEAM_A).toBe(GEO_WIN_THRESHOLD - 1);
    state = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_A", byName: "P", x: 0.5, y: 0.5 })); // queued, never locked
    state = mustOk(apply(state, { type: "START_COUNTDOWN", by: "HOST", durationMs: 10_000, nowMs: 0 }));

    const expired = checkExpiry(state, 10_000)!;
    expect(expired.status).toBe("finished"); // threshold reached, even though rounds 7-10 were never played
    expect(expired.scores.TEAM_A).toBe(GEO_WIN_THRESHOLD);
    expect(expired.winner).toBe("TEAM_A");
  });

  it("COUNTDOWN_EXPIRED (the real action the server dispatches) produces the identical resolution as checkExpiry's pure read", () => {
    const state = mustOk(apply(freshState(manyRoundsConfig(2)), { type: "START_COUNTDOWN", by: "HOST", durationMs: 10_000, nowMs: 0 }));
    const viaAction = mustOk(apply(state, { type: "COUNTDOWN_EXPIRED", by: "HOST" }));
    expect(viaAction.currentRoundIndex).toBe(1);
    expect(viaAction.phase).toBe("guessing");
    expect(viaAction.countdownDeadline).toBeNull();
  });

  it("COUNTDOWN_EXPIRED is rejected once the game has already finished, same as every other action", () => {
    const ended = mustOk(apply(freshState(), { type: "END_GAME", by: "HOST" }));
    const result = apply(ended, { type: "COUNTDOWN_EXPIRED", by: "HOST" });
    expect(!result.ok && result.error.code).toBe("GAME_ALREADY_FINISHED");
  });
});

describe("countdownDeadline is genuinely public — never redacted, unlike everything else in this state", () => {
  it("every role's toPublicView sees the exact same countdownDeadline the host does", () => {
    const state = mustOk(apply(freshState(), { type: "START_COUNTDOWN", by: "HOST", durationMs: 30_000, nowMs: 1_000 }));
    for (const role of ["HOST", "TEAM_A", "TEAM_B", "DISPLAY"] as const) {
      expect(toPublicView(state, role).countdownDeadline).toBe(31_000);
    }
  });
});

describe("availableActions", () => {
  it("HOST can END_GAME/START_COUNTDOWN any time, plus SKIP_ROUND while guessing or NEXT_ROUND once revealed", () => {
    expect(availableActions(freshState(), "HOST")).toEqual(["SKIP_ROUND", "END_GAME", "START_COUNTDOWN"]);
    const revealed = lockBothTeamsTeamAWins(freshState());
    expect(availableActions(revealed, "HOST")).toEqual(["NEXT_ROUND", "END_GAME", "START_COUNTDOWN"]);
  });

  it("HOST also sees CANCEL_COUNTDOWN once a countdown is actually running, not before", () => {
    const state = freshState();
    expect(availableActions(state, "HOST")).not.toContain("CANCEL_COUNTDOWN");
    const withCountdown = mustOk(apply(state, { type: "START_COUNTDOWN", by: "HOST", durationMs: 10_000, nowMs: 0 }));
    expect(availableActions(withCountdown, "HOST")).toEqual(["SKIP_ROUND", "END_GAME", "START_COUNTDOWN", "CANCEL_COUNTDOWN"]);
  });

  it("a team sees SET_GUESS, then LOCK_GUESS too once it has a proposal; nothing once locked", () => {
    let state = freshState();
    expect(availableActions(state, "TEAM_A")).toEqual(["SET_GUESS"]);
    state = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_A", byName: "P", x: 0.5, y: 0.5 }));
    expect(availableActions(state, "TEAM_A")).toEqual(["SET_GUESS", "LOCK_GUESS"]);
    state = mustOk(apply(state, { type: "LOCK_GUESS", by: "TEAM_A", proposalIndex: 0 }));
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
  it("HOST sees both teams' live proposals, guesses, and the real target", () => {
    let state = freshState();
    state = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_A", byName: "P", x: 0.3, y: 0.3 }));
    state = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_B", byName: "P", x: 0.7, y: 0.7 }));
    const hostView = toPublicView(state, "HOST");
    expect(hostView.proposals.TEAM_A).toEqual([{ x: 0.3, y: 0.3, byName: "P" }]);
    expect(hostView.proposals.TEAM_B).toEqual([{ x: 0.7, y: 0.7, byName: "P" }]);
    expect(hostView.rounds[0]!.targetX).toBe(0.5);
  });

  it("TEAM_A sees its own live proposals but never TEAM_B's, and the target stays hidden, before reveal", () => {
    let state = freshState();
    state = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_A", byName: "P", x: 0.3, y: 0.3 }));
    state = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_B", byName: "P", x: 0.7, y: 0.7 }));

    const teamAView = toPublicView(state, "TEAM_A");
    expect(teamAView.proposals.TEAM_A).toEqual([{ x: 0.3, y: 0.3, byName: "P" }]);
    expect(teamAView.proposals.TEAM_B).toEqual([]);
    expect(teamAView.rounds[0]!.targetX).toBeNull();
    expect(teamAView.rounds[0]!.targetY).toBeNull();
    // But the image AND question are visible — you have to know what
    // you're looking for, and be able to see the map, to play at all.
    expect(teamAView.rounds[0]!.imageUrl).toBe(sampleGeoPlaylist.rounds[0]!.imageUrl);
    expect(teamAView.rounds[0]!.question).toBe(sampleGeoPlaylist.rounds[0]!.question);

    const teamBView = toPublicView(state, "TEAM_B");
    expect(teamBView.proposals.TEAM_B).toEqual([{ x: 0.7, y: 0.7, byName: "P" }]);
    expect(teamBView.proposals.TEAM_A).toEqual([]);
  });

  it("DISPLAY never sees either team's live proposals or guesses before reveal", () => {
    let state = freshState();
    state = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_A", byName: "P", x: 0.3, y: 0.3 }));
    state = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_B", byName: "P", x: 0.7, y: 0.7 }));
    const displayView = toPublicView(state, "DISPLAY");
    expect(displayView.proposals.TEAM_A).toEqual([]);
    expect(displayView.proposals.TEAM_B).toEqual([]);
    expect(displayView.guesses.TEAM_A).toBeNull();
    expect(displayView.guesses.TEAM_B).toBeNull();
    expect(displayView.rounds[0]!.targetX).toBeNull();
  });

  it("a locked team's guess stays hidden from the other team until BOTH have locked, even though it's already 'final'", () => {
    let state = freshState();
    state = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_A", byName: "P", x: 0.5, y: 0.5 }));
    state = mustOk(apply(state, { type: "LOCK_GUESS", by: "TEAM_A", proposalIndex: 0 })); // TEAM_A locked, TEAM_B hasn't yet
    const teamBView = toPublicView(state, "TEAM_B");
    expect(teamBView.guesses.TEAM_A).toBeNull();
  });

  it("once revealed, everyone (including DISPLAY) sees both guesses and the real target — but proposals stay private (an unlocked candidate was never anyone's real answer)", () => {
    let state = freshState();
    state = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_A", byName: "Alice", x: 0.1, y: 0.1 })); // index 0 — a proposal TEAM_A never locks
    state = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_A", byName: "Bob", x: 0.5, y: 0.5 })); // index 1 — exactly on target, the one that gets locked
    state = mustOk(apply(state, { type: "SET_GUESS", by: "TEAM_B", byName: "P", x: 0.0, y: 0.0 })); // index 0 — far off
    state = mustOk(apply(state, { type: "LOCK_GUESS", by: "TEAM_A", proposalIndex: 1 }));
    const revealed = mustOk(apply(state, { type: "LOCK_GUESS", by: "TEAM_B", proposalIndex: 0 }));
    for (const role of ["TEAM_A", "TEAM_B", "DISPLAY"] as const) {
      const view = toPublicView(revealed, role);
      expect(view.guesses.TEAM_A).toEqual({ x: 0.5, y: 0.5 });
      expect(view.guesses.TEAM_B).toEqual({ x: 0.0, y: 0.0 });
      expect(view.rounds[0]!.targetX).toBe(0.5);
    }
    // TEAM_A's own rejected proposal ({0.1, 0.1}) is still only ever visible to TEAM_A, reveal or not.
    expect(toPublicView(revealed, "TEAM_A").proposals.TEAM_A).toContainEqual({ x: 0.1, y: 0.1, byName: "Alice" });
    expect(toPublicView(revealed, "TEAM_B").proposals.TEAM_A).toEqual([]);
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
