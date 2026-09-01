import { describe, expect, it } from "vitest";
import { getDrawingPlaylistReadiness, isPromptComplete } from "./drawingReadiness";

describe("isPromptComplete", () => {
  it("true only when text is present and non-blank", () => {
    expect(isPromptComplete({ text: "Chenille" })).toBe(true);
    expect(isPromptComplete({ text: null })).toBe(false);
    expect(isPromptComplete({ text: "" })).toBe(false);
    expect(isPromptComplete({ text: "   " })).toBe(false);
  });
});

describe("getDrawingPlaylistReadiness", () => {
  it("empty when there are no prompts at all", () => {
    const readiness = getDrawingPlaylistReadiness([]);
    expect(readiness.status).toBe("empty");
    expect(readiness.ready).toBe(false);
    expect(readiness.summary).toBe("Add a prompt to get started.");
  });

  it("incomplete when a prompt exists but is missing its text", () => {
    const readiness = getDrawingPlaylistReadiness([{ id: "p1", text: null }]);
    expect(readiness.status).toBe("incomplete");
    expect(readiness.ready).toBe(false);
    expect(readiness.incompletePrompts).toEqual([{ promptId: "p1" }]);
    expect(readiness.firstProblemPromptId).toBe("p1");
  });

  it("ready once every prompt has text", () => {
    const readiness = getDrawingPlaylistReadiness([
      { id: "p1", text: "Chenille" },
      { id: "p2", text: "Dragon" },
    ]);
    expect(readiness.status).toBe("ready");
    expect(readiness.ready).toBe(true);
    expect(readiness.completePromptCount).toBe(2);
    expect(readiness.incompletePrompts).toEqual([]);
    expect(readiness.firstProblemPromptId).toBeNull();
    expect(readiness.summary).toBe("Ready to play.");
  });

  it("counts complete/incomplete independently across a mixed list", () => {
    const readiness = getDrawingPlaylistReadiness([
      { id: "p1", text: "Chenille" },
      { id: "p2", text: null },
      { id: "p3", text: "" },
      { id: "p4", text: "Dragon" },
    ]);
    expect(readiness.promptCount).toBe(4);
    expect(readiness.completePromptCount).toBe(2);
    expect(readiness.incompletePrompts).toEqual([{ promptId: "p2" }, { promptId: "p3" }]);
    expect(readiness.firstProblemPromptId).toBe("p2");
    expect(readiness.summary).toBe("2 prompts are missing their word.");
  });
});
