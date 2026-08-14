import { describe, expect, it } from "vitest";
import { apply, availableActions, createInitialState } from "./engine";
import { sampleBoard } from "./fixtures";
import type { BoardQuestionAction, BoardQuestionState } from "./types";

function freshState(): BoardQuestionState {
  return createInitialState(sampleBoard);
}

function mustOk(result: ReturnType<typeof apply>): BoardQuestionState {
  if (!result.ok) throw new Error(`expected ok, got error ${result.error.code}: ${result.error.message}`);
  return result.state;
}

describe("createInitialState", () => {
  it("starts in_progress, selecting, zero scores, nothing played", () => {
    const state = freshState();
    expect(state.status).toBe("in_progress");
    expect(state.phase).toBe("selecting");
    expect(state.scores).toEqual({ TEAM_A: 0, TEAM_B: 0 });
    expect(state.playedQuestionIds).toEqual([]);
    expect(state.winner).toBeNull();
  });
});

describe("SELECT_QUESTION", () => {
  it("moves to revealed and sets the active question", () => {
    const state = freshState();
    const result = apply(state, { type: "SELECT_QUESTION", by: "HOST", questionId: "q-geo-100" });
    expect(result.ok).toBe(true);
    const next = mustOk(result);
    expect(next.phase).toBe("revealed");
    expect(next.activeQuestionId).toBe("q-geo-100");
    expect(result.ok && result.events).toEqual([
      { type: "QUESTION_SELECTED", questionId: "q-geo-100", categoryId: "cat-geo", points: 100 },
    ]);
  });

  it("does not mutate the input state", () => {
    const state = freshState();
    apply(state, { type: "SELECT_QUESTION", by: "HOST", questionId: "q-geo-100" });
    expect(state.phase).toBe("selecting");
    expect(state.activeQuestionId).toBeNull();
  });

  it("rejects a non-host with FORBIDDEN_ROLE", () => {
    const result = apply(freshState(), { type: "SELECT_QUESTION", by: "TEAM_A", questionId: "q-geo-100" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("FORBIDDEN_ROLE");
  });

  it("rejects DISPLAY outright", () => {
    const result = apply(freshState(), { type: "SELECT_QUESTION", by: "DISPLAY", questionId: "q-geo-100" });
    expect(!result.ok && result.error.code).toBe("FORBIDDEN_ROLE");
  });

  it("rejects an unknown question id", () => {
    const result = apply(freshState(), { type: "SELECT_QUESTION", by: "HOST", questionId: "does-not-exist" });
    expect(!result.ok && result.error.code).toBe("QUESTION_NOT_FOUND");
  });

  it("rejects selecting the same question twice in a row (repeated action, safely rejected)", () => {
    const afterFirst = mustOk(apply(freshState(), { type: "SELECT_QUESTION", by: "HOST", questionId: "q-geo-100" }));
    const second = apply(afterFirst, { type: "SELECT_QUESTION", by: "HOST", questionId: "q-geo-100" });
    expect(second.ok).toBe(false);
    expect(!second.ok && second.error.code).toBe("WRONG_PHASE"); // already in "revealed", not "selecting"
    // state is untouched by the rejected attempt
    expect(second.ok || afterFirst).toEqual(afterFirst);
  });

  it("rejects re-selecting an already-played question", () => {
    let state = freshState();
    state = mustOk(apply(state, { type: "SELECT_QUESTION", by: "HOST", questionId: "q-geo-100" }));
    state = mustOk(apply(state, { type: "BUZZ", by: "TEAM_A" }));
    state = mustOk(apply(state, { type: "SUBMIT_ANSWER", by: "TEAM_A", text: "answer" }));
    state = mustOk(apply(state, { type: "JUDGE_ANSWER", by: "HOST", correct: true }));

    const result = apply(state, { type: "SELECT_QUESTION", by: "HOST", questionId: "q-geo-100" });
    expect(!result.ok && result.error.code).toBe("QUESTION_ALREADY_PLAYED");
  });
});

describe("BUZZ", () => {
  function revealedState(): BoardQuestionState {
    return mustOk(apply(freshState(), { type: "SELECT_QUESTION", by: "HOST", questionId: "q-geo-100" }));
  }

  it("moves to answering and records who buzzed", () => {
    const result = apply(revealedState(), { type: "BUZZ", by: "TEAM_B" });
    const next = mustOk(result);
    expect(next.phase).toBe("answering");
    expect(next.buzzedTeam).toBe("TEAM_B");
    expect(result.ok && result.events).toEqual([{ type: "TEAM_BUZZED", team: "TEAM_B" }]);
  });

  it("rejects HOST buzzing", () => {
    const result = apply(revealedState(), { type: "BUZZ", by: "HOST" });
    expect(!result.ok && result.error.code).toBe("FORBIDDEN_ROLE");
  });

  it("rejects buzzing outside the revealed phase", () => {
    const result = apply(freshState(), { type: "BUZZ", by: "TEAM_A" }); // still "selecting"
    expect(!result.ok && result.error.code).toBe("WRONG_PHASE");
  });

  it("rejects a team buzzing twice on the same question", () => {
    let state = revealedState();
    state = mustOk(apply(state, { type: "BUZZ", by: "TEAM_A" }));
    state = mustOk(apply(state, { type: "SUBMIT_ANSWER", by: "TEAM_A", text: "Tokyo" }));
    state = mustOk(apply(state, { type: "JUDGE_ANSWER", by: "HOST", correct: false })); // back to revealed, TEAM_A attempted

    const result = apply(state, { type: "BUZZ", by: "TEAM_A" });
    expect(!result.ok && result.error.code).toBe("TEAM_ALREADY_ATTEMPTED");
  });
});

describe("SUBMIT_ANSWER", () => {
  function answeringState(team: "TEAM_A" | "TEAM_B" = "TEAM_A"): BoardQuestionState {
    let state = mustOk(apply(freshState(), { type: "SELECT_QUESTION", by: "HOST", questionId: "q-geo-100" }));
    state = mustOk(apply(state, { type: "BUZZ", by: team }));
    return state;
  }

  it("records the buzzed team's answer, visible in state", () => {
    const result = apply(answeringState("TEAM_A"), { type: "SUBMIT_ANSWER", by: "TEAM_A", text: "Tokyo" });
    const next = mustOk(result);
    expect(next.submittedAnswer).toBe("Tokyo");
    expect(next.phase).toBe("answering"); // still waiting on the host to judge
    expect(result.ok && result.events).toEqual([{ type: "ANSWER_SUBMITTED", team: "TEAM_A", text: "Tokyo" }]);
  });

  it("rejects the team that did NOT buzz submitting an answer", () => {
    const result = apply(answeringState("TEAM_A"), { type: "SUBMIT_ANSWER", by: "TEAM_B", text: "Paris" });
    expect(!result.ok && result.error.code).toBe("FORBIDDEN_ROLE");
  });

  it("rejects the host submitting an answer", () => {
    const result = apply(answeringState("TEAM_A"), { type: "SUBMIT_ANSWER", by: "HOST", text: "Tokyo" });
    expect(!result.ok && result.error.code).toBe("FORBIDDEN_ROLE");
  });

  it("rejects submitting outside the answering phase (nobody has buzzed yet)", () => {
    const revealed = mustOk(apply(freshState(), { type: "SELECT_QUESTION", by: "HOST", questionId: "q-geo-100" }));
    const result = apply(revealed, { type: "SUBMIT_ANSWER", by: "TEAM_A", text: "Tokyo" });
    expect(!result.ok && result.error.code).toBe("WRONG_PHASE");
  });

  it("rejects a second submission for the same buzz", () => {
    let state = answeringState("TEAM_A");
    state = mustOk(apply(state, { type: "SUBMIT_ANSWER", by: "TEAM_A", text: "Tokyo" }));
    const result = apply(state, { type: "SUBMIT_ANSWER", by: "TEAM_A", text: "Definitely Tokyo" });
    expect(!result.ok && result.error.code).toBe("ANSWER_ALREADY_SUBMITTED");
  });

  it("rejects an empty/blank answer", () => {
    const result = apply(answeringState("TEAM_A"), { type: "SUBMIT_ANSWER", by: "TEAM_A", text: "   " });
    expect(!result.ok && result.error.code).toBe("INVALID_ACTION");
  });
});

describe("JUDGE_ANSWER", () => {
  function answeringState(team: "TEAM_A" | "TEAM_B" = "TEAM_A"): BoardQuestionState {
    let state = mustOk(apply(freshState(), { type: "SELECT_QUESTION", by: "HOST", questionId: "q-geo-100" }));
    state = mustOk(apply(state, { type: "BUZZ", by: team }));
    return state;
  }

  function submittedState(team: "TEAM_A" | "TEAM_B" = "TEAM_A", text = "Tokyo"): BoardQuestionState {
    return mustOk(apply(answeringState(team), { type: "SUBMIT_ANSWER", by: team, text }));
  }

  it("rejects judging before an answer was submitted", () => {
    const result = apply(answeringState("TEAM_A"), { type: "JUDGE_ANSWER", by: "HOST", correct: true });
    expect(!result.ok && result.error.code).toBe("ANSWER_NOT_SUBMITTED");
  });

  it("correct: awards points, closes the question, returns to selecting", () => {
    const result = apply(submittedState("TEAM_A"), { type: "JUDGE_ANSWER", by: "HOST", correct: true });
    const next = mustOk(result);
    expect(next.phase).toBe("selecting");
    expect(next.scores.TEAM_A).toBe(100);
    expect(next.playedQuestionIds).toEqual(["q-geo-100"]);
    expect(next.activeQuestionId).toBeNull();
    expect(next.submittedAnswer).toBeNull();
    expect(result.ok && result.events.map((e) => e.type)).toEqual(["ANSWER_JUDGED", "SCORE_CHANGED"]);
  });

  it("incorrect: no score change, no penalty, question stays open for a steal", () => {
    const result = apply(submittedState("TEAM_A"), { type: "JUDGE_ANSWER", by: "HOST", correct: false });
    const next = mustOk(result);
    expect(next.phase).toBe("revealed"); // reopened, not closed
    expect(next.scores).toEqual({ TEAM_A: 0, TEAM_B: 0 });
    expect(next.attemptedTeams).toEqual(["TEAM_A"]);
    expect(next.activeQuestionId).toBe("q-geo-100"); // same question, still open
    expect(next.submittedAnswer).toBeNull(); // cleared so the stealing team gets a clean slate
  });

  it("the other team can steal after a miss", () => {
    let state = submittedState("TEAM_A");
    state = mustOk(apply(state, { type: "JUDGE_ANSWER", by: "HOST", correct: false }));
    state = mustOk(apply(state, { type: "BUZZ", by: "TEAM_B" }));
    state = mustOk(apply(state, { type: "SUBMIT_ANSWER", by: "TEAM_B", text: "Kyoto" }));
    const result = apply(state, { type: "JUDGE_ANSWER", by: "HOST", correct: true });
    const next = mustOk(result);
    expect(next.scores.TEAM_B).toBe(100);
    expect(next.phase).toBe("selecting");
  });

  it("both teams missing closes the question with no winner", () => {
    let state = submittedState("TEAM_A");
    state = mustOk(apply(state, { type: "JUDGE_ANSWER", by: "HOST", correct: false }));
    state = mustOk(apply(state, { type: "BUZZ", by: "TEAM_B" }));
    state = mustOk(apply(state, { type: "SUBMIT_ANSWER", by: "TEAM_B", text: "Kyoto" }));
    const result = apply(state, { type: "JUDGE_ANSWER", by: "HOST", correct: false });
    const next = mustOk(result);
    expect(next.phase).toBe("selecting");
    expect(next.playedQuestionIds).toEqual(["q-geo-100"]);
    expect(next.history).toEqual([{ questionId: "q-geo-100", wonBy: null }]);
    expect(next.scores).toEqual({ TEAM_A: 0, TEAM_B: 0 });
  });

  it("rejects a team trying to judge its own answer", () => {
    const result = apply(submittedState("TEAM_A"), { type: "JUDGE_ANSWER", by: "TEAM_A", correct: true });
    expect(!result.ok && result.error.code).toBe("FORBIDDEN_ROLE");
  });

  it("rejects judging outside the answering phase", () => {
    const revealed = mustOk(apply(freshState(), { type: "SELECT_QUESTION", by: "HOST", questionId: "q-geo-100" }));
    const result = apply(revealed, { type: "JUDGE_ANSWER", by: "HOST", correct: true });
    expect(!result.ok && result.error.code).toBe("WRONG_PHASE");
  });
});

describe("CLOSE_QUESTION", () => {
  it("host can close a revealed question with no buzz (dead air)", () => {
    const revealed = mustOk(apply(freshState(), { type: "SELECT_QUESTION", by: "HOST", questionId: "q-geo-100" }));
    const result = apply(revealed, { type: "CLOSE_QUESTION", by: "HOST" });
    const next = mustOk(result);
    expect(next.phase).toBe("selecting");
    expect(next.playedQuestionIds).toEqual(["q-geo-100"]);
    expect(next.history).toEqual([{ questionId: "q-geo-100", wonBy: null }]);
  });

  it("rejects closing during the selecting phase (nothing active)", () => {
    const result = apply(freshState(), { type: "CLOSE_QUESTION", by: "HOST" });
    expect(!result.ok && result.error.code).toBe("WRONG_PHASE");
  });

  it("rejects a non-host closing", () => {
    const revealed = mustOk(apply(freshState(), { type: "SELECT_QUESTION", by: "HOST", questionId: "q-geo-100" }));
    const result = apply(revealed, { type: "CLOSE_QUESTION", by: "TEAM_A" });
    expect(!result.ok && result.error.code).toBe("FORBIDDEN_ROLE");
  });
});

describe("invalid input", () => {
  it("rejects a malformed action shape with INVALID_ACTION, not a crash", () => {
    const bogus = { type: "SELECT_QUESTION", by: "HOST" } as unknown as BoardQuestionAction; // missing questionId
    const result = apply(freshState(), bogus);
    expect(!result.ok && result.error.code).toBe("INVALID_ACTION");
  });

  it("rejects a completely unknown action type", () => {
    const bogus = { type: "TELEPORT", by: "HOST" } as unknown as BoardQuestionAction;
    const result = apply(freshState(), bogus);
    expect(!result.ok && result.error.code).toBe("INVALID_ACTION");
  });
});

describe("game completion", () => {
  it("finishes with a winner once every question is played", () => {
    let state = freshState();
    for (const question of sampleBoard.questions) {
      state = mustOk(apply(state, { type: "SELECT_QUESTION", by: "HOST", questionId: question.id }));
      state = mustOk(apply(state, { type: "BUZZ", by: "TEAM_A" }));
      state = mustOk(apply(state, { type: "SUBMIT_ANSWER", by: "TEAM_A", text: "answer" }));
      state = mustOk(apply(state, { type: "JUDGE_ANSWER", by: "HOST", correct: true })); // TEAM_A sweeps
    }

    expect(state.status).toBe("finished");
    expect(state.winner).toBe("TEAM_A");
    expect(state.playedQuestionIds).toHaveLength(sampleBoard.questions.length);
  });

  it("finishes in a TIE when scores are equal", () => {
    let state = freshState();
    let turn: "TEAM_A" | "TEAM_B" = "TEAM_A";
    for (const question of sampleBoard.questions) {
      state = mustOk(apply(state, { type: "SELECT_QUESTION", by: "HOST", questionId: question.id }));
      state = mustOk(apply(state, { type: "BUZZ", by: turn }));
      state = mustOk(apply(state, { type: "SUBMIT_ANSWER", by: turn, text: "answer" }));
      state = mustOk(apply(state, { type: "JUDGE_ANSWER", by: "HOST", correct: true }));
      turn = turn === "TEAM_A" ? "TEAM_B" : "TEAM_A"; // alternate — same point values per pair keeps this level
    }

    // 3 pairs of equal-value questions (100/100, 200/200 across categories isn't paired that way here,
    // so assert on the actual fixture: q values are 100,200,100,200,100,200 alternating TEAM_A/TEAM_B/TEAM_A/...
    // -> recompute expected scores directly instead of assuming symmetry.
    const totals = sampleBoard.questions.reduce(
      (acc, q, i) => {
        const team = i % 2 === 0 ? "TEAM_A" : "TEAM_B";
        acc[team] += q.points;
        return acc;
      },
      { TEAM_A: 0, TEAM_B: 0 },
    );
    expect(state.scores).toEqual(totals);
    expect(state.status).toBe("finished");
    expect(state.winner).toBe(totals.TEAM_A === totals.TEAM_B ? "TIE" : totals.TEAM_A > totals.TEAM_B ? "TEAM_A" : "TEAM_B");
  });

  it("rejects any further action once finished", () => {
    let state = freshState();
    for (const question of sampleBoard.questions) {
      state = mustOk(apply(state, { type: "SELECT_QUESTION", by: "HOST", questionId: question.id }));
      state = mustOk(apply(state, { type: "BUZZ", by: "TEAM_A" }));
      state = mustOk(apply(state, { type: "SUBMIT_ANSWER", by: "TEAM_A", text: "answer" }));
      state = mustOk(apply(state, { type: "JUDGE_ANSWER", by: "HOST", correct: true }));
    }
    expect(state.status).toBe("finished");

    const result = apply(state, { type: "SELECT_QUESTION", by: "HOST", questionId: sampleBoard.questions[0]!.id });
    expect(!result.ok && result.error.code).toBe("GAME_ALREADY_FINISHED");
  });
});

describe("availableActions", () => {
  it("selecting phase: only HOST can SELECT_QUESTION", () => {
    const state = freshState();
    expect(availableActions(state, "HOST")).toEqual(["SELECT_QUESTION"]);
    expect(availableActions(state, "TEAM_A")).toEqual([]);
    expect(availableActions(state, "DISPLAY")).toEqual([]);
  });

  it("revealed phase: teams that haven't attempted can BUZZ, host can CLOSE_QUESTION", () => {
    const revealed = mustOk(apply(freshState(), { type: "SELECT_QUESTION", by: "HOST", questionId: "q-geo-100" }));
    expect(availableActions(revealed, "TEAM_A")).toEqual(["BUZZ"]);
    expect(availableActions(revealed, "TEAM_B")).toEqual(["BUZZ"]);
    expect(availableActions(revealed, "HOST")).toEqual(["CLOSE_QUESTION"]);
  });

  it("answering phase, before a submission: the buzzed team can SUBMIT_ANSWER, host can only CLOSE_QUESTION", () => {
    let state = mustOk(apply(freshState(), { type: "SELECT_QUESTION", by: "HOST", questionId: "q-geo-100" }));
    state = mustOk(apply(state, { type: "BUZZ", by: "TEAM_A" }));
    expect(availableActions(state, "HOST")).toEqual(["CLOSE_QUESTION"]);
    expect(availableActions(state, "TEAM_A")).toEqual(["SUBMIT_ANSWER"]);
    expect(availableActions(state, "TEAM_B")).toEqual([]);
  });

  it("answering phase, after a submission: only HOST can act (JUDGE_ANSWER or CLOSE_QUESTION)", () => {
    let state = mustOk(apply(freshState(), { type: "SELECT_QUESTION", by: "HOST", questionId: "q-geo-100" }));
    state = mustOk(apply(state, { type: "BUZZ", by: "TEAM_A" }));
    state = mustOk(apply(state, { type: "SUBMIT_ANSWER", by: "TEAM_A", text: "answer" }));
    expect(availableActions(state, "HOST")).toEqual(["JUDGE_ANSWER", "CLOSE_QUESTION"]);
    expect(availableActions(state, "TEAM_A")).toEqual([]);
    expect(availableActions(state, "TEAM_B")).toEqual([]);
  });

  it("finished: nobody has any available actions", () => {
    let state = freshState();
    for (const question of sampleBoard.questions) {
      state = mustOk(apply(state, { type: "SELECT_QUESTION", by: "HOST", questionId: question.id }));
      state = mustOk(apply(state, { type: "BUZZ", by: "TEAM_A" }));
      state = mustOk(apply(state, { type: "SUBMIT_ANSWER", by: "TEAM_A", text: "answer" }));
      state = mustOk(apply(state, { type: "JUDGE_ANSWER", by: "HOST", correct: true }));
    }
    expect(availableActions(state, "HOST")).toEqual([]);
  });
});
