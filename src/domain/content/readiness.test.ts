import { describe, expect, it } from "vitest";
import { getPlaylistReadiness, getQuestionIssues, isQuestionComplete } from "./readiness";
import type { CategoryReadinessInput } from "./readiness";

const complete = { value: 100, prompt: "Longest river?", answer: "The Amazon" };

describe("isQuestionComplete / getQuestionIssues", () => {
  it("a fully-filled question is complete", () => {
    expect(isQuestionComplete(complete)).toBe(true);
    expect(getQuestionIssues(complete)).toEqual([]);
  });

  it("flags a missing prompt", () => {
    const q = { ...complete, prompt: "" };
    expect(isQuestionComplete(q)).toBe(false);
    expect(getQuestionIssues(q)).toEqual(["MISSING_PROMPT"]);
  });

  it("flags a whitespace-only prompt the same as empty", () => {
    expect(getQuestionIssues({ ...complete, prompt: "   " })).toEqual(["MISSING_PROMPT"]);
  });

  it("flags a missing answer", () => {
    const q = { ...complete, answer: "" };
    expect(isQuestionComplete(q)).toBe(false);
    expect(getQuestionIssues(q)).toEqual(["MISSING_ANSWER"]);
  });

  it("flags an invalid (zero/negative/non-integer) value", () => {
    expect(getQuestionIssues({ ...complete, value: 0 })).toEqual(["INVALID_VALUE"]);
    expect(getQuestionIssues({ ...complete, value: -50 })).toEqual(["INVALID_VALUE"]);
    expect(getQuestionIssues({ ...complete, value: 100.5 })).toEqual(["INVALID_VALUE"]);
  });

  it("can flag multiple issues at once, in stable order", () => {
    expect(getQuestionIssues({ value: 0, prompt: "", answer: "" })).toEqual(["INVALID_VALUE", "MISSING_PROMPT", "MISSING_ANSWER"]);
  });
});

describe("getPlaylistReadiness", () => {
  it("a playlist with NO categories at all is 'empty'", () => {
    const readiness = getPlaylistReadiness([]);
    expect(readiness.status).toBe("empty");
    expect(readiness.ready).toBe(false);
    expect(readiness.categoryCount).toBe(0);
    expect(readiness.emptyCategories).toEqual([]);
    expect(readiness.firstProblem).toBeNull();
    expect(readiness.summary).toMatch(/add a category/i);
  });

  // The behavior this whole pass exists to fix: a category with zero
  // questions used to make the WHOLE PLAYLIST read as merely "empty"
  // (i.e. indistinguishable from having built nothing at all) as long as
  // some OTHER category had questions — silently never blocking "ready".
  // It must now be a real, named, blocking problem.
  it("a category with zero questions is 'incomplete', not 'empty' and not silently ignored", () => {
    const categories: CategoryReadinessInput[] = [{ id: "c1", name: "Geography", questions: [] }];
    const readiness = getPlaylistReadiness(categories);
    expect(readiness.status).toBe("incomplete");
    expect(readiness.ready).toBe(false);
    expect(readiness.categoryCount).toBe(1);
    expect(readiness.questionCount).toBe(0);
    expect(readiness.emptyCategories).toEqual([{ categoryId: "c1", categoryName: "Geography" }]);
    expect(readiness.summary).toBe("1 category empty.");
  });

  it("a board with SOME categories filled and one genuinely empty is 'incomplete', not 'ready'", () => {
    const categories: CategoryReadinessInput[] = [
      { id: "c1", name: "History", questions: [{ id: "q1", categoryId: "c1", value: 100, prompt: "P1", answer: "A1" }] },
      { id: "c2", name: "Science", questions: [] },
      { id: "c3", name: "Film", questions: [{ id: "q3", categoryId: "c3", value: 100, prompt: "P3", answer: "A3" }] },
    ];
    const readiness = getPlaylistReadiness(categories);
    expect(readiness.status).toBe("incomplete");
    expect(readiness.ready).toBe(false);
    expect(readiness.emptyCategories).toEqual([{ categoryId: "c2", categoryName: "Science" }]);
    // The two real, filled-in questions still count as complete —
    // an empty sibling category doesn't retroactively taint them.
    expect(readiness.completeQuestionCount).toBe(2);
    expect(readiness.firstProblem).toEqual({ type: "empty_category", categoryId: "c2", categoryName: "Science" });
  });

  it("a fully complete playlist (every category has at least one complete question) is 'ready'", () => {
    const categories: CategoryReadinessInput[] = [
      {
        id: "c1",
        name: "Geography",
        questions: [
          { id: "q1", categoryId: "c1", value: 100, prompt: "P1", answer: "A1" },
          { id: "q2", categoryId: "c1", value: 200, prompt: "P2", answer: "A2" },
        ],
      },
    ];
    const readiness = getPlaylistReadiness(categories);
    expect(readiness.status).toBe("ready");
    expect(readiness.ready).toBe(true);
    expect(readiness.questionCount).toBe(2);
    expect(readiness.completeQuestionCount).toBe(2);
    expect(readiness.incompleteQuestions).toEqual([]);
    expect(readiness.emptyCategories).toEqual([]);
    expect(readiness.firstProblem).toBeNull();
    expect(readiness.summary).toBe("Ready to play.");
  });

  it("a playlist with a question missing its answer is 'incomplete', flagged precisely", () => {
    const categories: CategoryReadinessInput[] = [
      {
        id: "c1",
        name: "Science",
        questions: [
          { id: "q1", categoryId: "c1", value: 100, prompt: "P1", answer: "A1" },
          { id: "q2", categoryId: "c1", value: 200, prompt: "P2", answer: "" },
        ],
      },
    ];
    const readiness = getPlaylistReadiness(categories);
    expect(readiness.status).toBe("incomplete");
    expect(readiness.ready).toBe(false);
    expect(readiness.completeQuestionCount).toBe(1);
    expect(readiness.incompleteQuestions).toHaveLength(1);
    expect(readiness.incompleteQuestions[0]).toMatchObject({ questionId: "q2", categoryId: "c1", categoryName: "Science", issues: ["MISSING_ANSWER"] });
    expect(readiness.firstProblem).toEqual({ type: "question", questionId: "q2", categoryId: "c1", categoryName: "Science" });
    expect(readiness.summary).toBe("1 question needs attention.");
  });

  it("summarizes multiple incomplete questions as one count, not a breakdown by issue kind", () => {
    const categories: CategoryReadinessInput[] = [
      {
        id: "c1",
        name: "Mixed",
        questions: [
          { id: "q1", categoryId: "c1", value: 100, prompt: "", answer: "A1" },
          { id: "q2", categoryId: "c1", value: 200, prompt: "P2", answer: "" },
          { id: "q3", categoryId: "c1", value: 300, prompt: "P3", answer: "" },
        ],
      },
    ];
    const readiness = getPlaylistReadiness(categories);
    expect(readiness.summary).toBe("3 questions need attention.");
  });

  it("reports both an empty category AND incomplete questions together when both exist", () => {
    const categories: CategoryReadinessInput[] = [
      { id: "c1", name: "History", questions: [{ id: "q1", categoryId: "c1", value: 100, prompt: "", answer: "A1" }] },
      { id: "c2", name: "Science", questions: [] },
    ];
    const readiness = getPlaylistReadiness(categories);
    expect(readiness.status).toBe("incomplete");
    expect(readiness.summary).toBe("1 category empty; 1 question needs attention.");
    // Board order: category "History" (with its broken question) comes
    // before "Science" (empty) — the first problem is the question, not
    // the empty category, because it's earlier on the board.
    expect(readiness.firstProblem).toEqual({ type: "question", questionId: "q1", categoryId: "c1", categoryName: "History" });
  });

  it("a playlist with a question missing its prompt is 'incomplete', flagged precisely", () => {
    const categories: CategoryReadinessInput[] = [
      { id: "c1", name: "Film", questions: [{ id: "q1", categoryId: "c1", value: 100, prompt: "", answer: "A1" }] },
    ];
    const readiness = getPlaylistReadiness(categories);
    expect(readiness.status).toBe("incomplete");
    expect(readiness.incompleteQuestions[0]?.issues).toEqual(["MISSING_PROMPT"]);
  });

  it("spans multiple categories correctly", () => {
    const categories: CategoryReadinessInput[] = [
      { id: "c1", name: "A", questions: [{ id: "q1", categoryId: "c1", value: 100, prompt: "P", answer: "A" }] },
      { id: "c2", name: "B", questions: [{ id: "q2", categoryId: "c2", value: 100, prompt: "", answer: "A" }] },
    ];
    const readiness = getPlaylistReadiness(categories);
    expect(readiness.categoryCount).toBe(2);
    expect(readiness.questionCount).toBe(2);
    expect(readiness.status).toBe("incomplete");
    expect(readiness.incompleteQuestions[0]?.categoryName).toBe("B");
  });
});
