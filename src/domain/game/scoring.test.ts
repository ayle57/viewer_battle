import { describe, expect, it } from "vitest";
import { addScore, checkFirstToN, initialScoreboard, leadingTeam } from "./scoring";

describe("addScore", () => {
  it("returns a new object, never mutates the input", () => {
    const before = initialScoreboard();
    const after = addScore(before, "TEAM_A", 100);
    expect(before).toEqual({ TEAM_A: 0, TEAM_B: 0 });
    expect(after).toEqual({ TEAM_A: 100, TEAM_B: 0 });
  });

  it("supports negative deltas", () => {
    const scores = addScore({ TEAM_A: 100, TEAM_B: 0 }, "TEAM_A", -50);
    expect(scores.TEAM_A).toBe(50);
  });
});

describe("checkFirstToN", () => {
  it("returns teams at or above the threshold, highest first", () => {
    expect(checkFirstToN({ TEAM_A: 500, TEAM_B: 300 }, 500)).toEqual(["TEAM_A"]);
  });

  it("returns both if both cross, ranked", () => {
    expect(checkFirstToN({ TEAM_A: 500, TEAM_B: 600 }, 500)).toEqual(["TEAM_B", "TEAM_A"]);
  });

  it("returns empty if neither has reached it", () => {
    expect(checkFirstToN({ TEAM_A: 100, TEAM_B: 200 }, 500)).toEqual([]);
  });
});

describe("leadingTeam", () => {
  it("returns the higher-scoring team", () => {
    expect(leadingTeam({ TEAM_A: 300, TEAM_B: 100 })).toBe("TEAM_A");
  });

  it("returns null on a tie, including 0-0", () => {
    expect(leadingTeam({ TEAM_A: 0, TEAM_B: 0 })).toBeNull();
    expect(leadingTeam({ TEAM_A: 200, TEAM_B: 200 })).toBeNull();
  });
});
