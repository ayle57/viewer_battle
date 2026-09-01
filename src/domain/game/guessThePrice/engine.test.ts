import { describe, expect, it } from "vitest";
import { apply, availableActions, createInitialState, GUESS_THE_PRICE_WIN_THRESHOLD } from "./engine";
import { toPublicView } from "./view";
import { sampleGuessThePricePlaylist } from "./fixtures";
import type { GuessThePriceConfig, GuessThePriceState } from "./types";

function freshState(config: GuessThePriceConfig = sampleGuessThePricePlaylist): GuessThePriceState {
  return createInitialState(config);
}

function mustOk(result: ReturnType<typeof apply>): GuessThePriceState {
  if (!result.ok) throw new Error(`expected ok, got error ${result.error.code}: ${result.error.message}`);
  return result.state;
}

/** BUZZ + SUBMIT_ANSWER in one step — the shared setup every JUDGE_ANSWER-adjacent test needs, same role as SteamRatingsEngine's own `reveal` helper played for this engine's own two-step "get to a judgeable answer" path. */
function buzzAndSubmit(state: GuessThePriceState, team: "TEAM_A" | "TEAM_B", guess = 45): GuessThePriceState {
  const buzzed = mustOk(apply(state, { type: "BUZZ", by: team }));
  return mustOk(apply(buzzed, { type: "SUBMIT_ANSWER", by: team, guess }));
}

describe("createInitialState", () => {
  it("starts in_progress, guessing, zero scores", () => {
    const state = freshState();
    expect(state.status).toBe("in_progress");
    expect(state.phase).toBe("guessing");
    expect(state.currentRoundIndex).toBe(0);
    expect(state.submittedGuess).toBeNull();
    expect(state.scores).toEqual({ TEAM_A: 0, TEAM_B: 0 });
    expect(state.history).toEqual([]);
    expect(state.winner).toBeNull();
  });

  it("does not mutate the input config", () => {
    const config = sampleGuessThePricePlaylist;
    const before = JSON.stringify(config);
    createInitialState(config);
    expect(JSON.stringify(config)).toBe(before);
  });

  it("defaults a missing marginPercent to null, not undefined", () => {
    const state = freshState();
    expect(state.rounds[1]!.marginPercent).toBeNull(); // round-2 has no marginPercent in the fixture
    expect(state.rounds[0]!.marginPercent).toBe(10); // round-1 does
  });
});

describe("BUZZ", () => {
  it("is legal the instant a round starts — no reveal step to wait on, the item is public from the start", () => {
    const result = apply(freshState(), { type: "BUZZ", by: "TEAM_A" });
    expect(result.ok).toBe(true);
  });

  it("moves to 'answering' and records the buzzing team, clearing any stale submittedGuess", () => {
    const result = apply(freshState(), { type: "BUZZ", by: "TEAM_B" });
    const next = mustOk(result);
    expect(next.phase).toBe("answering");
    expect(next.buzzedTeam).toBe("TEAM_B");
    expect(next.submittedGuess).toBeNull();
    expect(result.ok && result.events).toEqual([{ type: "TEAM_BUZZED", team: "TEAM_B" }]);
  });

  it("rejects the HOST buzzing", () => {
    const result = apply(freshState(), { type: "BUZZ", by: "HOST" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("FORBIDDEN_ROLE");
  });

  it("rejects a team that already attempted this round", () => {
    const buzzed = mustOk(apply(freshState(), { type: "BUZZ", by: "TEAM_A" }));
    const submitted = mustOk(apply(buzzed, { type: "SUBMIT_ANSWER", by: "TEAM_A", guess: 10 }));
    const stolen = mustOk(apply(submitted, { type: "JUDGE_ANSWER", by: "HOST", correct: false }));
    // TEAM_A already attempted — a second BUZZ from them should fail.
    const result = apply(stolen, { type: "BUZZ", by: "TEAM_A" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("TEAM_ALREADY_ATTEMPTED");
  });
});

describe("SUBMIT_ANSWER", () => {
  it("accepts a float and records it", () => {
    const buzzed = mustOk(apply(freshState(), { type: "BUZZ", by: "TEAM_A" }));
    const result = apply(buzzed, { type: "SUBMIT_ANSWER", by: "TEAM_A", guess: 44.5 });
    const next = mustOk(result);
    expect(next.submittedGuess).toBe(44.5);
    expect(result.ok && result.events).toEqual([{ type: "ANSWER_SUBMITTED", team: "TEAM_A", guess: 44.5 }]);
  });

  it("rejects a team that hasn't buzzed", () => {
    const result = apply(freshState(), { type: "SUBMIT_ANSWER", by: "TEAM_A", guess: 10 });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("WRONG_PHASE");
  });

  it("rejects the team that ISN'T currently on the floor", () => {
    const buzzed = mustOk(apply(freshState(), { type: "BUZZ", by: "TEAM_A" }));
    const result = apply(buzzed, { type: "SUBMIT_ANSWER", by: "TEAM_B", guess: 10 });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("FORBIDDEN_ROLE");
  });

  it("rejects the HOST submitting", () => {
    const buzzed = mustOk(apply(freshState(), { type: "BUZZ", by: "TEAM_A" }));
    const result = apply(buzzed, { type: "SUBMIT_ANSWER", by: "HOST", guess: 10 });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("FORBIDDEN_ROLE");
  });

  it("rejects a second submission for the same buzz", () => {
    const buzzed = mustOk(apply(freshState(), { type: "BUZZ", by: "TEAM_A" }));
    const submitted = mustOk(apply(buzzed, { type: "SUBMIT_ANSWER", by: "TEAM_A", guess: 10 }));
    const result = apply(submitted, { type: "SUBMIT_ANSWER", by: "TEAM_A", guess: 20 });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("ANSWER_ALREADY_SUBMITTED");
  });

  it("rejects a negative guess (schema-level, before the engine ever sees it)", () => {
    const buzzed = mustOk(apply(freshState(), { type: "BUZZ", by: "TEAM_A" }));
    const result = apply(buzzed, { type: "SUBMIT_ANSWER", by: "TEAM_A", guess: -5 });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("INVALID_ACTION");
  });
});

describe("JUDGE_ANSWER", () => {
  it("is legal once the buzzing team has submitted a guess", () => {
    const submitted = buzzAndSubmit(freshState(), "TEAM_A");
    const result = apply(submitted, { type: "JUDGE_ANSWER", by: "HOST", correct: true });
    expect(result.ok).toBe(true);
  });

  it("rejects judging before a guess has been submitted", () => {
    const buzzed = mustOk(apply(freshState(), { type: "BUZZ", by: "TEAM_A" }));
    const result = apply(buzzed, { type: "JUDGE_ANSWER", by: "HOST", correct: true });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("ANSWER_NOT_SUBMITTED");
  });

  it("correct: awards a point, closes and reveals the round", () => {
    const submitted = buzzAndSubmit(freshState(), "TEAM_A");
    const result = apply(submitted, { type: "JUDGE_ANSWER", by: "HOST", correct: true });
    const next = mustOk(result);
    expect(next.scores.TEAM_A).toBe(1);
    expect(next.phase).toBe("revealed");
    expect(next.buzzedTeam).toBeNull();
    expect(next.submittedGuess).toBeNull();
    expect(next.history).toEqual([{ roundId: "round-1", wonBy: "TEAM_A" }]);
    const types = result.ok ? result.events.map((e) => e.type) : [];
    expect(types).toEqual(["ANSWER_JUDGED", "SCORE_CHANGED"]);
  });

  it("incorrect with the other team not yet tried: reopens the floor for a steal, no round close", () => {
    const submitted = buzzAndSubmit(freshState(), "TEAM_A");
    const result = apply(submitted, { type: "JUDGE_ANSWER", by: "HOST", correct: false });
    const next = mustOk(result);
    expect(next.phase).toBe("guessing");
    expect(next.buzzedTeam).toBeNull();
    expect(next.submittedGuess).toBeNull();
    expect(next.attemptedTeams).toEqual(["TEAM_A"]);
    expect(next.scores).toEqual({ TEAM_A: 0, TEAM_B: 0 });
  });

  it("incorrect with both teams already tried: closes the round with no winner", () => {
    const submittedA = buzzAndSubmit(freshState(), "TEAM_A");
    const stolen = mustOk(apply(submittedA, { type: "JUDGE_ANSWER", by: "HOST", correct: false }));
    const submittedB = buzzAndSubmit(stolen, "TEAM_B");
    const result = apply(submittedB, { type: "JUDGE_ANSWER", by: "HOST", correct: false });
    const next = mustOk(result);
    expect(next.phase).toBe("revealed");
    expect(next.history).toEqual([{ roundId: "round-1", wonBy: null }]);
    expect(next.scores).toEqual({ TEAM_A: 0, TEAM_B: 0 });
  });

  it("rejects a non-host", () => {
    const submitted = buzzAndSubmit(freshState(), "TEAM_A");
    const result = apply(submitted, { type: "JUDGE_ANSWER", by: "TEAM_A", correct: true });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("FORBIDDEN_ROLE");
  });

  it("rejects judging with nobody buzzed", () => {
    const result = apply(freshState(), { type: "JUDGE_ANSWER", by: "HOST", correct: true });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("WRONG_PHASE");
  });
});

describe("SKIP_ROUND", () => {
  it("closes the round with no winner, legal the instant a round starts", () => {
    const result = apply(freshState(), { type: "SKIP_ROUND", by: "HOST" });
    const next = mustOk(result);
    expect(next.phase).toBe("revealed");
    expect(next.history).toEqual([{ roundId: "round-1", wonBy: null }]);
  });

  it("also legal mid-answer, before a guess has even been submitted", () => {
    const buzzed = mustOk(apply(freshState(), { type: "BUZZ", by: "TEAM_A" }));
    const result = apply(buzzed, { type: "SKIP_ROUND", by: "HOST" });
    expect(result.ok).toBe(true);
  });

  it("rejects a non-host", () => {
    const result = apply(freshState(), { type: "SKIP_ROUND", by: "TEAM_A" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("FORBIDDEN_ROLE");
  });

  it("rejects once already revealed", () => {
    const revealed = mustOk(apply(freshState(), { type: "SKIP_ROUND", by: "HOST" }));
    const result = apply(revealed, { type: "SKIP_ROUND", by: "HOST" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("WRONG_PHASE");
  });
});

describe("NEXT_ROUND", () => {
  it("advances to the next round, resetting phase", () => {
    const revealed = mustOk(apply(freshState(), { type: "SKIP_ROUND", by: "HOST" }));
    const result = apply(revealed, { type: "NEXT_ROUND", by: "HOST" });
    const next = mustOk(result);
    expect(next.currentRoundIndex).toBe(1);
    expect(next.phase).toBe("guessing");
    expect(result.ok && result.events).toEqual([{ type: "ROUND_ADVANCED", roundIndex: 1 }]);
  });

  it("rejects a non-host", () => {
    const revealed = mustOk(apply(freshState(), { type: "SKIP_ROUND", by: "HOST" }));
    const result = apply(revealed, { type: "NEXT_ROUND", by: "TEAM_A" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("FORBIDDEN_ROLE");
  });

  it("rejects when not yet revealed", () => {
    const result = apply(freshState(), { type: "NEXT_ROUND", by: "HOST" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("WRONG_PHASE");
  });
});

describe("finishing the game", () => {
  it("ends and picks a winner once the board runs out (2-round fixture)", () => {
    let state = mustOk(apply(freshState(), { type: "SKIP_ROUND", by: "HOST" }));
    state = mustOk(apply(state, { type: "NEXT_ROUND", by: "HOST" }));
    const submitted = buzzAndSubmit(state, "TEAM_A");
    const result = apply(submitted, { type: "JUDGE_ANSWER", by: "HOST", correct: true });
    const next = mustOk(result);
    expect(next.status).toBe("finished");
    expect(next.winner).toBe("TEAM_A");
    const types = result.ok ? result.events.map((e) => e.type) : [];
    expect(types).toContain("GAME_FINISHED");
  });

  it("reaches GUESS_THE_PRICE_WIN_THRESHOLD (6) before the board runs out with a long enough playlist", () => {
    const longConfig: GuessThePriceConfig = {
      rounds: Array.from({ length: 10 }, (_, i) => ({
        id: `round-${i}`,
        title: `Item ${i}`,
        imageUrl: "/images/price/sample-item.png",
        price: 20 + i,
      })),
    };
    let state = freshState(longConfig);
    for (let i = 0; i < GUESS_THE_PRICE_WIN_THRESHOLD; i++) {
      const submitted = buzzAndSubmit(state, "TEAM_A");
      const judged = mustOk(apply(submitted, { type: "JUDGE_ANSWER", by: "HOST", correct: true }));
      if (i < GUESS_THE_PRICE_WIN_THRESHOLD - 1) {
        state = mustOk(apply(judged, { type: "NEXT_ROUND", by: "HOST" }));
      } else {
        state = judged;
      }
    }
    expect(state.status).toBe("finished");
    expect(state.scores.TEAM_A).toBe(GUESS_THE_PRICE_WIN_THRESHOLD);
    expect(state.winner).toBe("TEAM_A");
  });

  it("ties if both teams have equal scores when the board runs out", () => {
    let state = mustOk(apply(freshState(), { type: "SKIP_ROUND", by: "HOST" }));
    state = mustOk(apply(state, { type: "NEXT_ROUND", by: "HOST" }));
    const result = apply(state, { type: "SKIP_ROUND", by: "HOST" });
    const next = mustOk(result);
    expect(next.status).toBe("finished");
    expect(next.winner).toBe("TIE");
  });

  it("actions are rejected once the game has finished", () => {
    let state = mustOk(apply(freshState(), { type: "SKIP_ROUND", by: "HOST" }));
    state = mustOk(apply(state, { type: "NEXT_ROUND", by: "HOST" }));
    state = mustOk(apply(state, { type: "SKIP_ROUND", by: "HOST" }));
    expect(state.status).toBe("finished");
    const result = apply(state, { type: "BUZZ", by: "TEAM_A" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("GAME_ALREADY_FINISHED");
  });
});

describe("END_GAME", () => {
  it("ends immediately, leading team wins", () => {
    const submitted = buzzAndSubmit(freshState(), "TEAM_B");
    const scored = mustOk(apply(submitted, { type: "JUDGE_ANSWER", by: "HOST", correct: true }));
    const state = mustOk(apply(scored, { type: "NEXT_ROUND", by: "HOST" }));
    const result = apply(state, { type: "END_GAME", by: "HOST" });
    const next = mustOk(result);
    expect(next.status).toBe("finished");
    expect(next.winner).toBe("TEAM_B");
  });

  it("rejects a non-host", () => {
    const result = apply(freshState(), { type: "END_GAME", by: "TEAM_A" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("FORBIDDEN_ROLE");
  });
});

describe("availableActions", () => {
  it("HOST in 'guessing': skip + end game", () => {
    expect(availableActions(freshState(), "HOST")).toEqual(["SKIP_ROUND", "END_GAME"]);
  });

  it("HOST in 'answering' before a guess is submitted: skip + end game, no judge yet", () => {
    const buzzed = mustOk(apply(freshState(), { type: "BUZZ", by: "TEAM_A" }));
    expect(availableActions(buzzed, "HOST")).toEqual(["SKIP_ROUND", "END_GAME"]);
  });

  it("HOST in 'answering' once a guess is submitted: judge + skip + end game", () => {
    const submitted = buzzAndSubmit(freshState(), "TEAM_A");
    expect(availableActions(submitted, "HOST")).toEqual(["JUDGE_ANSWER", "SKIP_ROUND", "END_GAME"]);
  });

  it("HOST once revealed: next round + end game", () => {
    const revealed = mustOk(apply(freshState(), { type: "SKIP_ROUND", by: "HOST" }));
    expect(availableActions(revealed, "HOST")).toEqual(["NEXT_ROUND", "END_GAME"]);
  });

  it("TEAM can BUZZ from the very start of a round — no reveal step to wait on", () => {
    expect(availableActions(freshState(), "TEAM_A")).toEqual(["BUZZ"]);
    expect(availableActions(freshState(), "TEAM_B")).toEqual(["BUZZ"]);
  });

  it("the buzzed team gets SUBMIT_ANSWER while nothing's submitted yet; the other team gets nothing", () => {
    const buzzed = mustOk(apply(freshState(), { type: "BUZZ", by: "TEAM_A" }));
    expect(availableActions(buzzed, "TEAM_A")).toEqual(["SUBMIT_ANSWER"]);
    expect(availableActions(buzzed, "TEAM_B")).toEqual([]);
  });

  it("once a guess is submitted, neither team has any further action — the Host judges from here", () => {
    const submitted = buzzAndSubmit(freshState(), "TEAM_A");
    expect(availableActions(submitted, "TEAM_A")).toEqual([]);
    expect(availableActions(submitted, "TEAM_B")).toEqual([]);
  });

  it("DISPLAY never has any actions", () => {
    expect(availableActions(freshState(), "DISPLAY")).toEqual([]);
  });

  it("nobody has actions once the game has finished", () => {
    let state = mustOk(apply(freshState(), { type: "SKIP_ROUND", by: "HOST" }));
    state = mustOk(apply(state, { type: "END_GAME", by: "HOST" }));
    expect(availableActions(state, "HOST")).toEqual([]);
    expect(availableActions(state, "TEAM_A")).toEqual([]);
  });
});

describe("toPublicView", () => {
  it("HOST sees the full state unredacted, including future rounds and every price", () => {
    const state = freshState();
    const view = toPublicView(state, "HOST");
    expect(view).toBe(state); // same reference — no redaction work done at all for HOST
  });

  it("current round: non-host roles see the item (title/imageUrl) but not the price or margin", () => {
    const view = toPublicView(freshState(), "TEAM_A");
    const round = view.rounds[0]!;
    expect(round.title).toBe("Sample Gadget");
    expect(round.imageUrl).toBe("/images/price/sample-item.png");
    expect(round.price).toBeNull();
    expect(round.marginPercent).toBeNull();
  });

  it("a future round is fully blanked — no title, no image, no price", () => {
    const view = toPublicView(freshState(), "DISPLAY");
    const future = view.rounds[1]!;
    expect(future.title).toBeNull();
    expect(future.imageUrl).toBeNull();
    expect(future.price).toBeNull();
  });

  it("a submitted guess is visible to every role, same posture as buzzedTeam", () => {
    const submitted = buzzAndSubmit(freshState(), "TEAM_A", 39.99);
    const view = toPublicView(submitted, "TEAM_B");
    expect(view.submittedGuess).toBe(39.99);
  });

  it("once revealed, the current round is fully public — price and margin included", () => {
    const revealed = mustOk(apply(freshState(), { type: "SKIP_ROUND", by: "HOST" }));
    const view = toPublicView(revealed, "TEAM_A");
    const round = view.rounds[0]!;
    expect(round.title).toBe("Sample Gadget");
    expect(round.price).toBe(49.99);
    expect(round.marginPercent).toBe(10);
  });

  it("a played round stays fully public once the game has moved past it", () => {
    let state = mustOk(apply(freshState(), { type: "SKIP_ROUND", by: "HOST" }));
    state = mustOk(apply(state, { type: "NEXT_ROUND", by: "HOST" }));
    const view = toPublicView(state, "TEAM_B");
    const played = view.rounds[0]!;
    expect(played.title).toBe("Sample Gadget");
    expect(played.price).toBe(49.99);
  });
});
