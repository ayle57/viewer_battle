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
  it("an empty playlist (no categories) is 'empty', not 'incomplete'", () => {
    const readiness = getPlaylistReadiness([]);
    expect(readiness.status).toBe("empty");
    expect(readiness.ready).toBe(false);
    expect(readiness.summary).toMatch(/get started/i);
  });

  it("a playlist with categories but zero questions is 'empty'", () => {
    const categories: CategoryReadinessInput[] = [{ id: "c1", name: "Geography", questions: [] }];
    const readiness = getPlaylistReadiness(categories);
    expect(readiness.status).toBe("empty");
    expect(readiness.categoryCount).toBe(1);
    expect(readiness.questionCount).toBe(0);
  });

  it("a fully complete playlist is 'ready'", () => {
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
    expect(readiness.summary).toMatch(/missing an answer/);
  });

  it("a playlist with a question missing its prompt is 'incomplete', flagged precisely", () => {
    const categories: CategoryReadinessInput[] = [
      { id: "c1", name: "Film", questions: [{ id: "q1", categoryId: "c1", value: 100, prompt: "", answer: "A1" }] },
    ];
    const readiness = getPlaylistReadiness(categories);
    expect(readiness.status).toBe("incomplete");
    expect(readiness.incompleteQuestions[0]?.issues).toEqual(["MISSING_PROMPT"]);
    expect(readiness.summary).toMatch(/missing question text/);
  });

  it("summarizes multiple simultaneous issue kinds as one readable sentence", () => {
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
    expect(readiness.summary).toBe("2 questions missing answers; 1 question missing question text.");
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
