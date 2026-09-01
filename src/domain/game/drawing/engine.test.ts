import { describe, expect, it } from "vitest";
import { apply, availableActions, checkExpiry, createInitialState, DRAWING_WIN_THRESHOLD } from "./engine";
import { toPublicView } from "./view";
import { sampleDrawingPlaylist } from "./fixtures";
import type { DrawingAction, DrawingState } from "./types";

function freshState(): DrawingState {
  return createInitialState(sampleDrawingPlaylist);
}

function mustOk(result: ReturnType<typeof apply>): DrawingState {
  if (!result.ok) throw new Error(`expected ok, got error ${result.error.code}: ${result.error.message}`);
  return result.state;
}

const NOW = 1_000_000;

describe("createInitialState", () => {
  it("starts in_progress, choosing_drawer, TEAM_A active, zero scores", () => {
    const state = freshState();
    expect(state.status).toBe("in_progress");
    expect(state.phase).toBe("choosing_drawer");
    expect(state.activeTeam).toBe("TEAM_A");
    expect(state.drawerName).toBeNull();
    expect(state.currentPromptIndex).toBe(0);
    expect(state.scores).toEqual({ TEAM_A: 0, TEAM_B: 0 });
    expect(state.winner).toBeNull();
    expect(state.history).toEqual([]);
  });
});

describe("CHOOSE_DRAWER", () => {
  it("moves to drawing, sets drawerName, and starts a countdown sized by the current prompt's own duration", () => {
    const state = freshState();
    const result = apply(state, { type: "CHOOSE_DRAWER", by: "TEAM_A", byName: "Alice", nowMs: NOW });
    expect(result.ok).toBe(true);
    const next = mustOk(result);
    expect(next.phase).toBe("drawing");
    expect(next.drawerName).toBe("Alice");
    expect(next.countdownDeadline).toBe(NOW + sampleDrawingPlaylist.prompts[0]!.durationSeconds * 1000);
    expect(result.ok && result.events).toEqual([
      { type: "DRAWER_CHOSEN", team: "TEAM_A", drawerName: "Alice" },
      { type: "COUNTDOWN_STARTED", deadlineMs: NOW + sampleDrawingPlaylist.prompts[0]!.durationSeconds * 1000 },
    ]);
  });

  it("does not mutate the input state", () => {
    const state = freshState();
    apply(state, { type: "CHOOSE_DRAWER", by: "TEAM_A", byName: "Alice", nowMs: NOW });
    expect(state.phase).toBe("choosing_drawer");
    expect(state.drawerName).toBeNull();
  });

  it("rejects the inactive team with FORBIDDEN_ROLE", () => {
    const result = apply(freshState(), { type: "CHOOSE_DRAWER", by: "TEAM_B", byName: "Bob", nowMs: NOW });
    expect(!result.ok && result.error.code).toBe("FORBIDDEN_ROLE");
  });

  it("rejects HOST/DISPLAY with FORBIDDEN_ROLE", () => {
    const hostResult = apply(freshState(), { type: "CHOOSE_DRAWER", by: "HOST", byName: "Streamer", nowMs: NOW });
    expect(!hostResult.ok && hostResult.error.code).toBe("FORBIDDEN_ROLE");
    const displayResult = apply(freshState(), { type: "CHOOSE_DRAWER", by: "DISPLAY", byName: "Screen", nowMs: NOW });
    expect(!displayResult.ok && displayResult.error.code).toBe("FORBIDDEN_ROLE");
  });

  it("a second claim from the same team loses the race (WRONG_PHASE, not a special error)", () => {
    const afterFirst = mustOk(apply(freshState(), { type: "CHOOSE_DRAWER", by: "TEAM_A", byName: "Alice", nowMs: NOW }));
    const second = apply(afterFirst, { type: "CHOOSE_DRAWER", by: "TEAM_A", byName: "Aaron", nowMs: NOW + 10 });
    expect(!second.ok && second.error.code).toBe("WRONG_PHASE");
    // the loser's attempt changed nothing
    expect(second.ok || afterFirst).toEqual(afterFirst);
  });
});

describe("prompt-text redaction (toPublicView)", () => {
  it("HOST always sees the real current prompt text", () => {
    const state = freshState();
    expect(toPublicView(state, "HOST").prompts[0]!.text).toBe(sampleDrawingPlaylist.prompts[0]!.text);
  });

  it("every non-host role — including the active team itself — sees a blanked current prompt", () => {
    const state = mustOk(apply(freshState(), { type: "CHOOSE_DRAWER", by: "TEAM_A", byName: "Alice", nowMs: NOW }));
    for (const role of ["TEAM_A", "TEAM_B", "DISPLAY"] as const) {
      expect(toPublicView(state, role).prompts[state.currentPromptIndex]!.text).toBe("");
    }
  });

  it("future prompts stay blanked for non-host roles too (no reading ahead)", () => {
    const state = freshState();
    const view = toPublicView(state, "TEAM_A");
    expect(view.prompts.every((p) => p.text === "")).toBe(true);
  });

  it("a prompt already turned (index < currentPromptIndex) is fully public", () => {
    let state = freshState();
    state = mustOk(apply(state, { type: "CHOOSE_DRAWER", by: "TEAM_A", byName: "Alice", nowMs: NOW }));
    state = mustOk(apply(state, { type: "COUNTDOWN_EXPIRED", by: "HOST" }));
    state = mustOk(apply(state, { type: "JUDGE_GUESS", by: "HOST", correct: true }));
    expect(state.phase).toBe("resolved"); // judging alone doesn't advance the index yet — see NEXT_PROMPT's own describe block
    state = mustOk(apply(state, { type: "NEXT_PROMPT", by: "HOST" }));
    expect(state.currentPromptIndex).toBe(1);
    const view = toPublicView(state, "TEAM_B");
    expect(view.prompts[0]!.text).toBe(sampleDrawingPlaylist.prompts[0]!.text);
    expect(view.prompts[1]!.text).toBe(""); // the new current prompt is still hidden
  });

  it("drawerName is never redacted — visible to every role once set", () => {
    const state = mustOk(apply(freshState(), { type: "CHOOSE_DRAWER", by: "TEAM_A", byName: "Alice", nowMs: NOW }));
    for (const role of ["TEAM_A", "TEAM_B", "DISPLAY"] as const) {
      expect(toPublicView(state, role).drawerName).toBe("Alice");
    }
  });
});

describe("JUDGE_GUESS", () => {
  function inGuessingPhase(): DrawingState {
    return mustOk(apply(freshState(), { type: "CHOOSE_DRAWER", by: "TEAM_A", byName: "Alice", nowMs: NOW }));
  }

  it("rejects judging before the countdown expires (still 'drawing')", () => {
    const result = apply(inGuessingPhase(), { type: "JUDGE_GUESS", by: "HOST", correct: true });
    expect(!result.ok && result.error.code).toBe("WRONG_PHASE");
  });

  it("correct: awards the ACTIVE team a point and moves to 'resolved' — the turn itself hasn't advanced yet", () => {
    let state = inGuessingPhase();
    state = mustOk(apply(state, { type: "COUNTDOWN_EXPIRED", by: "HOST" }));
    expect(state.phase).toBe("guessing");

    const result = apply(state, { type: "JUDGE_GUESS", by: "HOST", correct: true });
    const next = mustOk(result);
    expect(next.scores).toEqual({ TEAM_A: 1, TEAM_B: 0 });
    expect(next.phase).toBe("resolved");
    // Nothing about the turn itself has moved on yet — a real reaction
    // beat, not an instant cut (see NEXT_PROMPT's own describe block for
    // what actually advances these).
    expect(next.activeTeam).toBe("TEAM_A");
    expect(next.currentPromptIndex).toBe(0);
    expect(next.drawerName).toBe("Alice");
    expect(next.history).toEqual([{ promptId: "prompt-1", promptText: "Caterpillar", team: "TEAM_A", drawerName: "Alice", correct: true }]);
    expect(result.ok && result.events.map((e) => e.type)).toEqual(["GUESS_JUDGED", "SCORE_CHANGED"]);
  });

  it("incorrect: awards the OTHER team a point automatically, still just moves to 'resolved'", () => {
    let state = inGuessingPhase();
    state = mustOk(apply(state, { type: "COUNTDOWN_EXPIRED", by: "HOST" }));

    const next = mustOk(apply(state, { type: "JUDGE_GUESS", by: "HOST", correct: false }));
    expect(next.scores).toEqual({ TEAM_A: 0, TEAM_B: 1 }); // TEAM_A was active/guessing, TEAM_B (the "enemy") gets the point
    expect(next.phase).toBe("resolved");
    expect(next.activeTeam).toBe("TEAM_A"); // still hasn't advanced — see NEXT_PROMPT
    expect(next.history[0]!.correct).toBe(false);
  });

  it("rejects a non-host judge with FORBIDDEN_ROLE", () => {
    let state = inGuessingPhase();
    state = mustOk(apply(state, { type: "COUNTDOWN_EXPIRED", by: "HOST" }));
    const result = apply(state, { type: "JUDGE_GUESS", by: "TEAM_A", correct: true });
    expect(!result.ok && result.error.code).toBe("FORBIDDEN_ROLE");
  });

  it("rejects judging again once already 'resolved'", () => {
    let state = inGuessingPhase();
    state = mustOk(apply(state, { type: "COUNTDOWN_EXPIRED", by: "HOST" }));
    state = mustOk(apply(state, { type: "JUDGE_GUESS", by: "HOST", correct: true }));
    const result = apply(state, { type: "JUDGE_GUESS", by: "HOST", correct: true });
    expect(!result.ok && result.error.code).toBe("WRONG_PHASE");
  });
});

describe("NEXT_PROMPT", () => {
  function resolvedState(): DrawingState {
    let state = mustOk(apply(freshState(), { type: "CHOOSE_DRAWER", by: "TEAM_A", byName: "Alice", nowMs: NOW }));
    state = mustOk(apply(state, { type: "COUNTDOWN_EXPIRED", by: "HOST" }));
    return mustOk(apply(state, { type: "JUDGE_GUESS", by: "HOST", correct: true }));
  }

  it("rejects advancing before the turn is resolved", () => {
    const result = apply(freshState(), { type: "NEXT_PROMPT", by: "HOST" });
    expect(!result.ok && result.error.code).toBe("WRONG_PHASE");
  });

  it("advances the turn to the OTHER team, into a fresh 'choosing_drawer' with no drawer/countdown", () => {
    const result = apply(resolvedState(), { type: "NEXT_PROMPT", by: "HOST" });
    const next = mustOk(result);
    expect(next.phase).toBe("choosing_drawer");
    expect(next.currentPromptIndex).toBe(1);
    expect(next.activeTeam).toBe("TEAM_B"); // turn passes regardless of who won the point
    expect(next.drawerName).toBeNull();
    expect(next.countdownDeadline).toBeNull();
    expect(result.ok && result.events).toEqual([{ type: "TURN_ADVANCED", promptIndex: 1, activeTeam: "TEAM_B" }]);
  });

  it("rejects a non-host", () => {
    const result = apply(resolvedState(), { type: "NEXT_PROMPT", by: "TEAM_A" });
    expect(!result.ok && result.error.code).toBe("FORBIDDEN_ROLE");
  });
});

describe("SKIP_TURN", () => {
  it("closes the turn with no score change from 'choosing_drawer' (before anyone's even drawn)", () => {
    const result = apply(freshState(), { type: "SKIP_TURN", by: "HOST" });
    const next = mustOk(result);
    expect(next.phase).toBe("resolved");
    expect(next.scores).toEqual({ TEAM_A: 0, TEAM_B: 0 });
    expect(next.history).toEqual([{ promptId: "prompt-1", promptText: "Caterpillar", team: "TEAM_A", drawerName: null, correct: null }]);
    expect(result.ok && result.events).toEqual([{ type: "TURN_SKIPPED", team: "TEAM_A" }]);
  });

  it("closes the turn from 'drawing' too, cancelling the running countdown", () => {
    const drawing = mustOk(apply(freshState(), { type: "CHOOSE_DRAWER", by: "TEAM_A", byName: "Alice", nowMs: NOW }));
    const result = apply(drawing, { type: "SKIP_TURN", by: "HOST" });
    const next = mustOk(result);
    expect(next.phase).toBe("resolved");
    expect(next.countdownDeadline).toBeNull();
    expect(next.history[0]).toEqual({ promptId: "prompt-1", promptText: "Caterpillar", team: "TEAM_A", drawerName: "Alice", correct: null });
    expect(result.ok && result.events).toEqual([{ type: "TURN_SKIPPED", team: "TEAM_A" }, { type: "COUNTDOWN_CANCELLED" }]);
  });

  it("closes the turn from 'guessing' too", () => {
    let state = mustOk(apply(freshState(), { type: "CHOOSE_DRAWER", by: "TEAM_A", byName: "Alice", nowMs: NOW }));
    state = mustOk(apply(state, { type: "COUNTDOWN_EXPIRED", by: "HOST" }));
    const next = mustOk(apply(state, { type: "SKIP_TURN", by: "HOST" }));
    expect(next.phase).toBe("resolved");
    expect(next.history[0]!.correct).toBeNull();
  });

  it("does not affect alternation — NEXT_PROMPT still passes the turn to the other team", () => {
    const skipped = mustOk(apply(freshState(), { type: "SKIP_TURN", by: "HOST" }));
    const next = mustOk(apply(skipped, { type: "NEXT_PROMPT", by: "HOST" }));
    expect(next.activeTeam).toBe("TEAM_B");
    expect(next.currentPromptIndex).toBe(1);
  });

  it("rejects skipping again once already 'resolved'", () => {
    const skipped = mustOk(apply(freshState(), { type: "SKIP_TURN", by: "HOST" }));
    const result = apply(skipped, { type: "SKIP_TURN", by: "HOST" });
    expect(!result.ok && result.error.code).toBe("WRONG_PHASE");
  });

  it("rejects a non-host", () => {
    const result = apply(freshState(), { type: "SKIP_TURN", by: "TEAM_A" });
    expect(!result.ok && result.error.code).toBe("FORBIDDEN_ROLE");
  });

  it("skipping the last prompt finishes the game gracefully (highest score wins)", () => {
    let state = createInitialState({ prompts: [{ id: "only", text: "Word", durationSeconds: 30 }] });
    const result = apply(state, { type: "SKIP_TURN", by: "HOST" });
    const next = mustOk(result);
    expect(next.status).toBe("finished");
    expect(next.winner).toBe("TIE"); // 0-0, nobody scored
    expect(next.phase).toBe("resolved"); // the skip's own outcome stays visible, same as a judged finish
  });

  it("a player can never skip a turn — HOST-only, same as judging", () => {
    for (const role of ["TEAM_A", "TEAM_B", "DISPLAY"] as const) {
      const result = apply(freshState(), { type: "SKIP_TURN", by: role });
      expect(!result.ok && result.error.code).toBe("FORBIDDEN_ROLE");
    }
  });
});

describe("turn alternation across multiple prompts", () => {
  it("alternates TEAM_A / TEAM_B every turn, regardless of who wins the point", () => {
    let state = freshState();
    const seenTeams: string[] = [];
    for (let i = 0; i < 4; i++) {
      seenTeams.push(state.activeTeam);
      state = mustOk(apply(state, { type: "CHOOSE_DRAWER", by: state.activeTeam, byName: `player-${i}`, nowMs: NOW }));
      state = mustOk(apply(state, { type: "COUNTDOWN_EXPIRED", by: "HOST" }));
      state = mustOk(apply(state, { type: "JUDGE_GUESS", by: "HOST", correct: i % 2 === 0 }));
      state = mustOk(apply(state, { type: "NEXT_PROMPT", by: "HOST" }));
    }
    expect(seenTeams).toEqual(["TEAM_A", "TEAM_B", "TEAM_A", "TEAM_B"]);
  });
});

describe("winning the match", () => {
  it("finishes at DRAWING_WIN_THRESHOLD (6) round-wins, winner is the leading team", () => {
    // Drive every point to TEAM_A regardless of who's active: TEAM_A
    // draws -> judge correct (TEAM_A +1); TEAM_B draws -> judge incorrect
    // (the "enemy" of TEAM_B, i.e. TEAM_A, +1) — needs a longer playlist
    // than the 8-prompt sample since a real match takes up to 11 turns to
    // reach 6-0 this way (TEAM_A active on odd-numbered turns only).
    const longPlaylist = {
      prompts: Array.from({ length: 12 }, (_, i) => ({ id: `p-${i}`, text: `word-${i}`, durationSeconds: 30 })),
    };
    let state = createInitialState(longPlaylist);
    let i = 0;
    let lastDrawerName = "";
    while (state.status !== "finished") {
      const activeTeam = state.activeTeam;
      lastDrawerName = `p-${i}`;
      state = mustOk(apply(state, { type: "CHOOSE_DRAWER", by: activeTeam, byName: lastDrawerName, nowMs: NOW }));
      state = mustOk(apply(state, { type: "COUNTDOWN_EXPIRED", by: "HOST" }));
      state = mustOk(apply(state, { type: "JUDGE_GUESS", by: "HOST", correct: activeTeam === "TEAM_A" }));
      if (state.status !== "finished") {
        state = mustOk(apply(state, { type: "NEXT_PROMPT", by: "HOST" }));
      }
      i++;
    }
    expect(state.status).toBe("finished");
    expect(state.scores.TEAM_A).toBe(DRAWING_WIN_THRESHOLD);
    expect(state.winner).toBe("TEAM_A");
    expect(state.phase).toBe("resolved"); // the winning turn's own outcome stays visible
    expect(state.drawerName).toBe(lastDrawerName); // NEXT_PROMPT (which clears it) never ran for the winning turn
    expect(state.countdownDeadline).toBeNull();
  });

  it("falls back to leading team / TIE when the playlist runs out before threshold", () => {
    let state = createInitialState({ prompts: [{ id: "only", text: "Word", durationSeconds: 30 }] });
    state = mustOk(apply(state, { type: "CHOOSE_DRAWER", by: "TEAM_A", byName: "Alice", nowMs: NOW }));
    state = mustOk(apply(state, { type: "COUNTDOWN_EXPIRED", by: "HOST" }));
    state = mustOk(apply(state, { type: "JUDGE_GUESS", by: "HOST", correct: true }));
    expect(state.status).toBe("finished");
    expect(state.winner).toBe("TEAM_A");
    expect(state.scores).toEqual({ TEAM_A: 1, TEAM_B: 0 });
  });

  it("no further actions are accepted once finished", () => {
    let state = createInitialState({ prompts: [{ id: "only", text: "Word", durationSeconds: 30 }] });
    state = mustOk(apply(state, { type: "CHOOSE_DRAWER", by: "TEAM_A", byName: "Alice", nowMs: NOW }));
    state = mustOk(apply(state, { type: "COUNTDOWN_EXPIRED", by: "HOST" }));
    state = mustOk(apply(state, { type: "JUDGE_GUESS", by: "HOST", correct: true }));
    const result = apply(state, { type: "END_GAME", by: "HOST" });
    expect(!result.ok && result.error.code).toBe("GAME_ALREADY_FINISHED");
  });
});

describe("ADJUST_COUNTDOWN", () => {
  function inDrawingPhase(): DrawingState {
    return mustOk(apply(freshState(), { type: "CHOOSE_DRAWER", by: "TEAM_A", byName: "Alice", nowMs: NOW }));
  }

  it("host can add time, extending the deadline", () => {
    const before = inDrawingPhase();
    const result = apply(before, { type: "ADJUST_COUNTDOWN", by: "HOST", deltaSeconds: 10, nowMs: NOW + 1000 });
    const next = mustOk(result);
    expect(next.countdownDeadline).toBe(before.countdownDeadline! + 10_000);
    expect(result.ok && result.events).toEqual([{ type: "COUNTDOWN_STARTED", deadlineMs: next.countdownDeadline }]);
  });

  it("host can remove time, shortening the deadline", () => {
    const before = inDrawingPhase();
    const next = mustOk(apply(before, { type: "ADJUST_COUNTDOWN", by: "HOST", deltaSeconds: -10, nowMs: NOW + 1000 }));
    expect(next.countdownDeadline).toBe(before.countdownDeadline! - 10_000);
  });

  it("removing more time than remains clamps to at least 1s in the future, never negative/zero", () => {
    const before = inDrawingPhase(); // 30s duration by default sample prompt
    const nowMs = NOW + 2000;
    const next = mustOk(apply(before, { type: "ADJUST_COUNTDOWN", by: "HOST", deltaSeconds: -999, nowMs }));
    expect(next.countdownDeadline).toBe(nowMs + 1000);
  });

  it("rejects a non-host", () => {
    const result = apply(inDrawingPhase(), { type: "ADJUST_COUNTDOWN", by: "TEAM_A", deltaSeconds: 10, nowMs: NOW });
    expect(!result.ok && result.error.code).toBe("FORBIDDEN_ROLE");
  });

  it("rejects adjusting outside the drawing phase (no countdown running)", () => {
    const result = apply(freshState(), { type: "ADJUST_COUNTDOWN", by: "HOST", deltaSeconds: 10, nowMs: NOW });
    expect(!result.ok && result.error.code).toBe("NO_COUNTDOWN_ACTIVE");
  });
});

describe("COUNTDOWN_EXPIRED / checkExpiry", () => {
  it("moves drawing -> guessing without forcing a guess", () => {
    let state = mustOk(apply(freshState(), { type: "CHOOSE_DRAWER", by: "TEAM_A", byName: "Alice", nowMs: NOW }));
    state = mustOk(apply(state, { type: "COUNTDOWN_EXPIRED", by: "HOST" }));
    expect(state.phase).toBe("guessing");
    expect(state.countdownDeadline).toBeNull();
  });

  it("is a no-op outside the 'drawing' phase", () => {
    const state = freshState(); // choosing_drawer
    const result = apply(state, { type: "COUNTDOWN_EXPIRED", by: "HOST" });
    expect(mustOk(result)).toEqual(state);
  });

  it("checkExpiry self-heals a passed deadline the same way the real-time timer would", () => {
    const chosen = mustOk(apply(freshState(), { type: "CHOOSE_DRAWER", by: "TEAM_A", byName: "Alice", nowMs: NOW }));
    const before = chosen.countdownDeadline!;
    expect(checkExpiry(chosen, before - 1)).toBeNull(); // not expired yet
    const healed = checkExpiry(chosen, before + 1);
    expect(healed).not.toBeNull();
    expect(healed!.phase).toBe("guessing");
  });

  it("checkExpiry is a no-op once finished", () => {
    let state = createInitialState({ prompts: [{ id: "only", text: "Word", durationSeconds: 30 }] });
    state = mustOk(apply(state, { type: "CHOOSE_DRAWER", by: "TEAM_A", byName: "Alice", nowMs: NOW }));
    state = mustOk(apply(state, { type: "END_GAME", by: "HOST" }));
    expect(checkExpiry(state, NOW + 999_999)).toBeNull();
  });
});

describe("END_GAME", () => {
  it("host can end early from any phase; highest score wins", () => {
    let state = freshState();
    state = mustOk(apply(state, { type: "CHOOSE_DRAWER", by: "TEAM_A", byName: "Alice", nowMs: NOW }));
    const result = apply(state, { type: "END_GAME", by: "HOST" });
    const next = mustOk(result);
    expect(next.status).toBe("finished");
    expect(next.winner).toBe("TIE"); // 0-0
    expect(next.countdownDeadline).toBeNull();
  });

  it("rejects a non-host", () => {
    const result = apply(freshState(), { type: "END_GAME", by: "TEAM_A" });
    expect(!result.ok && result.error.code).toBe("FORBIDDEN_ROLE");
  });
});

describe("availableActions", () => {
  it("offers CHOOSE_DRAWER only to the active team during choosing_drawer; HOST can also skip", () => {
    const state = freshState();
    expect(availableActions(state, "TEAM_A")).toEqual(["CHOOSE_DRAWER"]);
    expect(availableActions(state, "TEAM_B")).toEqual([]);
    expect(availableActions(state, "DISPLAY")).toEqual([]);
    expect(availableActions(state, "HOST")).toEqual(["SKIP_TURN", "END_GAME"]);
  });

  it("offers ADJUST_COUNTDOWN and SKIP_TURN to HOST during drawing", () => {
    const state = mustOk(apply(freshState(), { type: "CHOOSE_DRAWER", by: "TEAM_A", byName: "Alice", nowMs: NOW }));
    expect(availableActions(state, "HOST")).toEqual(["ADJUST_COUNTDOWN", "SKIP_TURN", "END_GAME"]);
    expect(availableActions(state, "TEAM_A")).toEqual([]);
    expect(availableActions(state, "TEAM_B")).toEqual([]);
  });

  it("offers JUDGE_GUESS and SKIP_TURN to HOST during guessing", () => {
    let state = mustOk(apply(freshState(), { type: "CHOOSE_DRAWER", by: "TEAM_A", byName: "Alice", nowMs: NOW }));
    state = mustOk(apply(state, { type: "COUNTDOWN_EXPIRED", by: "HOST" }));
    expect(availableActions(state, "HOST")).toEqual(["JUDGE_GUESS", "SKIP_TURN", "END_GAME"]);
    expect(availableActions(state, "TEAM_A")).toEqual([]);
    expect(availableActions(state, "TEAM_B")).toEqual([]);
  });

  it("offers only NEXT_PROMPT (plus END_GAME) to HOST once resolved — no more skipping a turn that's already closed", () => {
    let state = mustOk(apply(freshState(), { type: "CHOOSE_DRAWER", by: "TEAM_A", byName: "Alice", nowMs: NOW }));
    state = mustOk(apply(state, { type: "COUNTDOWN_EXPIRED", by: "HOST" }));
    state = mustOk(apply(state, { type: "JUDGE_GUESS", by: "HOST", correct: true }));
    expect(availableActions(state, "HOST")).toEqual(["NEXT_PROMPT", "END_GAME"]);
    expect(availableActions(state, "TEAM_A")).toEqual([]);
    expect(availableActions(state, "TEAM_B")).toEqual([]);
  });

  it("returns nothing once finished", () => {
    let state = createInitialState({ prompts: [{ id: "only", text: "Word", durationSeconds: 30 }] });
    state = mustOk(apply(state, { type: "END_GAME", by: "HOST" }));
    expect(availableActions(state, "HOST")).toEqual([]);
  });
});

describe("invalid/unknown actions", () => {
  it("rejects a malformed action with INVALID_ACTION", () => {
    const result = apply(freshState(), { type: "CHOOSE_DRAWER", by: "TEAM_A" } as unknown as DrawingAction);
    expect(!result.ok && result.error.code).toBe("INVALID_ACTION");
  });
});
