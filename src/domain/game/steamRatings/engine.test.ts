import { describe, expect, it } from "vitest";
import { apply, availableActions, createInitialState, STEAM_RATINGS_WIN_THRESHOLD } from "./engine";
import { toPublicView } from "./view";
import { sampleSteamRatingsPlaylist } from "./fixtures";
import type { SteamRatingsConfig, SteamRatingsState } from "./types";

function freshState(config: SteamRatingsConfig = sampleSteamRatingsPlaylist): SteamRatingsState {
  return createInitialState(config);
}

function mustOk(result: ReturnType<typeof apply>): SteamRatingsState {
  if (!result.ok) throw new Error(`expected ok, got error ${result.error.code}: ${result.error.message}`);
  return result.state;
}

function reveal(state: SteamRatingsState, times = 1): SteamRatingsState {
  let next = state;
  for (let i = 0; i < times; i++) next = mustOk(apply(next, { type: "REVEAL_NEXT_RATING", by: "HOST" }));
  return next;
}

describe("createInitialState", () => {
  it("starts in_progress, guessing, nothing revealed, zero scores", () => {
    const state = freshState();
    expect(state.status).toBe("in_progress");
    expect(state.phase).toBe("guessing");
    expect(state.currentRoundIndex).toBe(0);
    expect(state.revealedCount).toBe(0);
    expect(state.scores).toEqual({ TEAM_A: 0, TEAM_B: 0 });
    expect(state.history).toEqual([]);
    expect(state.winner).toBeNull();
  });

  it("does not mutate the input config", () => {
    const config = sampleSteamRatingsPlaylist;
    const before = JSON.stringify(config);
    createInitialState(config);
    expect(JSON.stringify(config)).toBe(before);
  });
});

describe("REVEAL_NEXT_RATING", () => {
  it("increments revealedCount and emits RATING_REVEALED", () => {
    const result = apply(freshState(), { type: "REVEAL_NEXT_RATING", by: "HOST" });
    const next = mustOk(result);
    expect(next.revealedCount).toBe(1);
    expect(result.ok && result.events).toEqual([{ type: "RATING_REVEALED", roundIndex: 0, revealedCount: 1 }]);
  });

  it("does not mutate the input state", () => {
    const state = freshState();
    apply(state, { type: "REVEAL_NEXT_RATING", by: "HOST" });
    expect(state.revealedCount).toBe(0);
  });

  it("rejects a non-host", () => {
    const result = apply(freshState(), { type: "REVEAL_NEXT_RATING", by: "TEAM_A" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("FORBIDDEN_ROLE");
  });

  it("rejects once every rating for the round has been revealed", () => {
    const roundRatingCount = sampleSteamRatingsPlaylist.rounds[0]!.ratings.length;
    const state = reveal(freshState(), roundRatingCount);
    const result = apply(state, { type: "REVEAL_NEXT_RATING", by: "HOST" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("NO_RATINGS_REMAINING");
  });

  it("is not legal once a team has buzzed (phase 'answering')", () => {
    const state = mustOk(apply(reveal(freshState()), { type: "BUZZ", by: "TEAM_A" }));
    const result = apply(state, { type: "REVEAL_NEXT_RATING", by: "HOST" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("WRONG_PHASE");
  });
});

describe("BUZZ", () => {
  it("rejects before any rating has been revealed", () => {
    const result = apply(freshState(), { type: "BUZZ", by: "TEAM_A" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("NOTHING_REVEALED_YET");
  });

  it("moves to 'answering' and records the buzzing team once at least one rating is revealed", () => {
    const state = reveal(freshState());
    const result = apply(state, { type: "BUZZ", by: "TEAM_B" });
    const next = mustOk(result);
    expect(next.phase).toBe("answering");
    expect(next.buzzedTeam).toBe("TEAM_B");
    expect(result.ok && result.events).toEqual([{ type: "TEAM_BUZZED", team: "TEAM_B" }]);
  });

  it("rejects the HOST buzzing", () => {
    const result = apply(reveal(freshState()), { type: "BUZZ", by: "HOST" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("FORBIDDEN_ROLE");
  });

  it("rejects a team that already attempted this round", () => {
    const buzzed = mustOk(apply(reveal(freshState()), { type: "BUZZ", by: "TEAM_A" }));
    const stolen = mustOk(apply(buzzed, { type: "JUDGE_ANSWER", by: "HOST", correct: false }));
    // TEAM_A already attempted — a second BUZZ from them should fail.
    const result = apply(stolen, { type: "BUZZ", by: "TEAM_A" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("TEAM_ALREADY_ATTEMPTED");
  });
});

describe("JUDGE_ANSWER", () => {
  it("is legal the instant a team has buzzed — no typed-answer step to wait on (answers are oral)", () => {
    const buzzed = mustOk(apply(reveal(freshState()), { type: "BUZZ", by: "TEAM_A" }));
    const result = apply(buzzed, { type: "JUDGE_ANSWER", by: "HOST", correct: true });
    expect(result.ok).toBe(true);
  });

  it("correct: awards a point, closes and reveals the round", () => {
    const buzzed = mustOk(apply(reveal(freshState()), { type: "BUZZ", by: "TEAM_A" }));
    const result = apply(buzzed, { type: "JUDGE_ANSWER", by: "HOST", correct: true });
    const next = mustOk(result);
    expect(next.scores.TEAM_A).toBe(1);
    expect(next.phase).toBe("revealed");
    expect(next.buzzedTeam).toBeNull();
    expect(next.history).toEqual([{ roundId: "round-1", wonBy: "TEAM_A" }]);
    const types = result.ok ? result.events.map((e) => e.type) : [];
    expect(types).toEqual(["ANSWER_JUDGED", "SCORE_CHANGED"]);
  });

  it("incorrect with the other team not yet tried: reopens the floor for a steal, no round close", () => {
    const buzzed = mustOk(apply(reveal(freshState()), { type: "BUZZ", by: "TEAM_A" }));
    const result = apply(buzzed, { type: "JUDGE_ANSWER", by: "HOST", correct: false });
    const next = mustOk(result);
    expect(next.phase).toBe("guessing");
    expect(next.buzzedTeam).toBeNull();
    expect(next.attemptedTeams).toEqual(["TEAM_A"]);
    expect(next.scores).toEqual({ TEAM_A: 0, TEAM_B: 0 });
  });

  it("incorrect with both teams already tried: closes the round with no winner", () => {
    const buzzedA = mustOk(apply(reveal(freshState()), { type: "BUZZ", by: "TEAM_A" }));
    const stolen = mustOk(apply(buzzedA, { type: "JUDGE_ANSWER", by: "HOST", correct: false }));
    const buzzedB = mustOk(apply(stolen, { type: "BUZZ", by: "TEAM_B" }));
    const result = apply(buzzedB, { type: "JUDGE_ANSWER", by: "HOST", correct: false });
    const next = mustOk(result);
    expect(next.phase).toBe("revealed");
    expect(next.history).toEqual([{ roundId: "round-1", wonBy: null }]);
    expect(next.scores).toEqual({ TEAM_A: 0, TEAM_B: 0 });
  });

  it("rejects a non-host", () => {
    const buzzed = mustOk(apply(reveal(freshState()), { type: "BUZZ", by: "TEAM_A" }));
    const result = apply(buzzed, { type: "JUDGE_ANSWER", by: "TEAM_A", correct: true });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("FORBIDDEN_ROLE");
  });

  it("rejects judging with nobody buzzed", () => {
    const result = apply(reveal(freshState()), { type: "JUDGE_ANSWER", by: "HOST", correct: true });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("WRONG_PHASE");
  });
});

describe("SKIP_ROUND", () => {
  it("closes the round with no winner once at least one rating is revealed", () => {
    const state = reveal(freshState());
    const result = apply(state, { type: "SKIP_ROUND", by: "HOST" });
    const next = mustOk(result);
    expect(next.phase).toBe("revealed");
    expect(next.history).toEqual([{ roundId: "round-1", wonBy: null }]);
  });

  it("rejects before any rating has been revealed", () => {
    const result = apply(freshState(), { type: "SKIP_ROUND", by: "HOST" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("NOTHING_REVEALED_YET");
  });

  it("rejects a non-host", () => {
    const result = apply(reveal(freshState()), { type: "SKIP_ROUND", by: "TEAM_A" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("FORBIDDEN_ROLE");
  });

  it("rejects once already revealed", () => {
    const revealed = mustOk(apply(reveal(freshState()), { type: "SKIP_ROUND", by: "HOST" }));
    const result = apply(revealed, { type: "SKIP_ROUND", by: "HOST" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("WRONG_PHASE");
  });
});

describe("NEXT_ROUND", () => {
  it("advances to the next round, resetting revealedCount and phase", () => {
    const revealed = mustOk(apply(reveal(freshState()), { type: "SKIP_ROUND", by: "HOST" }));
    const result = apply(revealed, { type: "NEXT_ROUND", by: "HOST" });
    const next = mustOk(result);
    expect(next.currentRoundIndex).toBe(1);
    expect(next.phase).toBe("guessing");
    expect(next.revealedCount).toBe(0);
    expect(result.ok && result.events).toEqual([{ type: "ROUND_ADVANCED", roundIndex: 1 }]);
  });

  it("rejects a non-host", () => {
    const revealed = mustOk(apply(reveal(freshState()), { type: "SKIP_ROUND", by: "HOST" }));
    const result = apply(revealed, { type: "NEXT_ROUND", by: "TEAM_A" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("FORBIDDEN_ROLE");
  });

  it("rejects when not yet revealed", () => {
    const result = apply(reveal(freshState()), { type: "NEXT_ROUND", by: "HOST" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("WRONG_PHASE");
  });
});

describe("finishing the game", () => {
  it("ends and picks a winner once the board runs out (2-round fixture)", () => {
    let state = freshState();
    state = mustOk(apply(reveal(state), { type: "SKIP_ROUND", by: "HOST" }));
    state = mustOk(apply(state, { type: "NEXT_ROUND", by: "HOST" }));
    const buzzed = mustOk(apply(reveal(state), { type: "BUZZ", by: "TEAM_A" }));
    const result = apply(buzzed, { type: "JUDGE_ANSWER", by: "HOST", correct: true });
    const next = mustOk(result);
    expect(next.status).toBe("finished");
    expect(next.winner).toBe("TEAM_A");
    const types = result.ok ? result.events.map((e) => e.type) : [];
    expect(types).toContain("GAME_FINISHED");
  });

  it("reaches STEAM_RATINGS_WIN_THRESHOLD (6) before the board runs out with a long enough playlist", () => {
    const longConfig: SteamRatingsConfig = {
      rounds: Array.from({ length: 10 }, (_, i) => ({
        id: `round-${i}`,
        title: `Game ${i}`,
        imageUrl: "/images/steam/sample-cover.png",
        ratings: ["a", "b"],
      })),
    };
    let state = freshState(longConfig);
    for (let i = 0; i < STEAM_RATINGS_WIN_THRESHOLD; i++) {
      const buzzed = mustOk(apply(reveal(state), { type: "BUZZ", by: "TEAM_A" }));
      const judged = mustOk(apply(buzzed, { type: "JUDGE_ANSWER", by: "HOST", correct: true }));
      if (i < STEAM_RATINGS_WIN_THRESHOLD - 1) {
        state = mustOk(apply(judged, { type: "NEXT_ROUND", by: "HOST" }));
      } else {
        state = judged;
      }
    }
    expect(state.status).toBe("finished");
    expect(state.scores.TEAM_A).toBe(STEAM_RATINGS_WIN_THRESHOLD);
    expect(state.winner).toBe("TEAM_A");
  });

  it("ties if both teams have equal scores when the board runs out", () => {
    // 2-round fixture: skip round 1 (no points), then close round 2 by
    // skip as well (nothing revealed check requires a reveal first).
    let state = mustOk(apply(reveal(freshState()), { type: "SKIP_ROUND", by: "HOST" }));
    state = mustOk(apply(state, { type: "NEXT_ROUND", by: "HOST" }));
    const result = apply(reveal(state), { type: "SKIP_ROUND", by: "HOST" });
    const next = mustOk(result);
    expect(next.status).toBe("finished");
    expect(next.winner).toBe("TIE");
  });

  it("actions are rejected once the game has finished", () => {
    let state = mustOk(apply(reveal(freshState()), { type: "SKIP_ROUND", by: "HOST" }));
    state = mustOk(apply(state, { type: "NEXT_ROUND", by: "HOST" }));
    state = mustOk(apply(reveal(state), { type: "SKIP_ROUND", by: "HOST" }));
    expect(state.status).toBe("finished");
    const result = apply(state, { type: "REVEAL_NEXT_RATING", by: "HOST" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("GAME_ALREADY_FINISHED");
  });
});

describe("END_GAME", () => {
  it("ends immediately, leading team wins", () => {
    const buzzed = mustOk(apply(reveal(freshState()), { type: "BUZZ", by: "TEAM_B" }));
    const scored = mustOk(apply(buzzed, { type: "JUDGE_ANSWER", by: "HOST", correct: true }));
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
  it("HOST in 'guessing' with nothing revealed: only reveal + end game (skip not offered yet)", () => {
    expect(availableActions(freshState(), "HOST")).toEqual(["REVEAL_NEXT_RATING", "END_GAME"]);
  });

  it("HOST in 'guessing' with everything revealed: skip + end game, no reveal", () => {
    const roundRatingCount = sampleSteamRatingsPlaylist.rounds[0]!.ratings.length;
    const state = reveal(freshState(), roundRatingCount);
    expect(availableActions(state, "HOST")).toEqual(["SKIP_ROUND", "END_GAME"]);
  });

  it("HOST in 'answering': judge + skip + end game, immediately once a team has buzzed (oral answers, no typed step)", () => {
    const buzzed = mustOk(apply(reveal(freshState()), { type: "BUZZ", by: "TEAM_A" }));
    expect(availableActions(buzzed, "HOST")).toEqual(["JUDGE_ANSWER", "SKIP_ROUND", "END_GAME"]);
  });

  it("HOST once revealed: next round + end game", () => {
    const revealed = mustOk(apply(reveal(freshState()), { type: "SKIP_ROUND", by: "HOST" }));
    expect(availableActions(revealed, "HOST")).toEqual(["NEXT_ROUND", "END_GAME"]);
  });

  it("TEAM with nothing revealed: no BUZZ offered", () => {
    expect(availableActions(freshState(), "TEAM_A")).toEqual([]);
  });

  it("TEAM once something's revealed and they haven't attempted: BUZZ", () => {
    const state = reveal(freshState());
    expect(availableActions(state, "TEAM_A")).toEqual(["BUZZ"]);
    expect(availableActions(state, "TEAM_B")).toEqual(["BUZZ"]);
  });

  it("once a team has buzzed, neither team has any further action — the answer is oral, judged by the Host directly", () => {
    const buzzed = mustOk(apply(reveal(freshState()), { type: "BUZZ", by: "TEAM_A" }));
    expect(availableActions(buzzed, "TEAM_A")).toEqual([]);
    expect(availableActions(buzzed, "TEAM_B")).toEqual([]);
  });

  it("DISPLAY never has any actions", () => {
    expect(availableActions(freshState(), "DISPLAY")).toEqual([]);
    expect(availableActions(reveal(freshState()), "DISPLAY")).toEqual([]);
  });

  it("nobody has actions once the game has finished", () => {
    let state = mustOk(apply(reveal(freshState()), { type: "SKIP_ROUND", by: "HOST" }));
    state = mustOk(apply(state, { type: "END_GAME", by: "HOST" }));
    expect(availableActions(state, "HOST")).toEqual([]);
    expect(availableActions(state, "TEAM_A")).toEqual([]);
  });
});

describe("toPublicView", () => {
  it("HOST sees the full state unredacted, including future rounds and every rating", () => {
    const state = freshState();
    const view = toPublicView(state, "HOST");
    expect(view).toBe(state); // same reference — no redaction work done at all for HOST
  });

  it("current round: non-host roles see only the ratings revealed so far, title/imageUrl hidden", () => {
    const state = reveal(freshState(), 2);
    const view = toPublicView(state, "TEAM_A");
    const round = view.rounds[0]!;
    expect(round.ratings).toEqual(sampleSteamRatingsPlaylist.rounds[0]!.ratings.slice(0, 2));
    expect(round.title).toBeNull();
    expect(round.imageUrl).toBeNull();
  });

  it("current round still at zero reveals: ratings is an empty array, not the full list", () => {
    const view = toPublicView(freshState(), "TEAM_B");
    expect(view.rounds[0]!.ratings).toEqual([]);
  });

  it("a future round is fully blanked — no ratings, no title, no image", () => {
    const view = toPublicView(freshState(), "DISPLAY");
    const future = view.rounds[1]!;
    expect(future.ratings).toEqual([]);
    expect(future.title).toBeNull();
    expect(future.imageUrl).toBeNull();
  });

  it("once revealed, the current round is fully public — every rating, title, and image", () => {
    const revealed = mustOk(apply(reveal(freshState()), { type: "SKIP_ROUND", by: "HOST" }));
    const view = toPublicView(revealed, "TEAM_A");
    const round = view.rounds[0]!;
    expect(round.ratings).toEqual(sampleSteamRatingsPlaylist.rounds[0]!.ratings);
    expect(round.title).toBe("Sample Game");
    expect(round.imageUrl).toBe("/images/steam/sample-cover.png");
  });

  it("a played round stays fully public once the game has moved past it", () => {
    let state = mustOk(apply(reveal(freshState()), { type: "SKIP_ROUND", by: "HOST" }));
    state = mustOk(apply(state, { type: "NEXT_ROUND", by: "HOST" }));
    const view = toPublicView(state, "TEAM_B");
    const played = view.rounds[0]!;
    expect(played.title).toBe("Sample Game");
    expect(played.ratings).toEqual(sampleSteamRatingsPlaylist.rounds[0]!.ratings);
  });
});
