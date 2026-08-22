import { describe, expect, it } from "vitest";
import { describeLastResult } from "./events";

/**
 * The real bug this file exists to lock down: `describeLastResult` used
 * to interpolate the server's own raw `team` enum value directly
 * ("TEAM_A"/"TEAM_B") into player-facing copy — confirmed via real
 * Chromium testing, a judged-correct answer showed "TEAM_A got it —
 * +100" on the Player screen, a technical string leaking straight onto
 * a broadcast-facing UI, every other team label in this app reads
 * "Team A"/"Team B".
 */
describe("describeLastResult", () => {
  it("formats a correct judgment with the human-readable team label, not the raw enum", () => {
    const result = describeLastResult([{ type: "ANSWER_JUDGED", team: "TEAM_A", correct: true, pointsAwarded: 100 }]);
    expect(result).toBe("Team A got it — +100");
  });

  it("formats an incorrect judgment the same way", () => {
    const result = describeLastResult([{ type: "ANSWER_JUDGED", team: "TEAM_B", correct: false }]);
    expect(result).toBe("Team B got it wrong.");
  });

  it("still reads the LAST relevant event, not the first, when several are present", () => {
    const result = describeLastResult([
      { type: "ANSWER_JUDGED", team: "TEAM_A", correct: false },
      { type: "ANSWER_JUDGED", team: "TEAM_B", correct: true, pointsAwarded: 200 },
    ]);
    expect(result).toBe("Team B got it — +200"); // scans from the end — the SECOND event is what the reverse loop finds first
  });
});
