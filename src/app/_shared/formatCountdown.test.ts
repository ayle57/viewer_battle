import { describe, expect, it } from "vitest";
import { formatCountdown } from "./formatCountdown";

describe("formatCountdown", () => {
  it("renders M:SS, floored (not rounded) — the last visible second is really the last one", () => {
    expect(formatCountdown(60_000)).toBe("1:00");
    expect(formatCountdown(59_999)).toBe("0:59"); // one ms under a minute floors down, never rounds up to 1:00
    expect(formatCountdown(9_000)).toBe("0:09");
    expect(formatCountdown(1_999)).toBe("0:01"); // floored, not rounded to 0:02
    expect(formatCountdown(0)).toBe("0:00");
  });

  it("never goes negative even if called a moment after the deadline already passed", () => {
    expect(formatCountdown(-500)).toBe("0:00");
  });
});
