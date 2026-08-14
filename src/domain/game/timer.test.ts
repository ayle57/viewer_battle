import { describe, expect, it } from "vitest";
import { computeDeadline, isExpired, remainingMs } from "./timer";

describe("timer helpers (pure — no Date.now() involved)", () => {
  it("computeDeadline adds duration to a given now", () => {
    expect(computeDeadline(1000, 30_000)).toBe(31_000);
  });

  it("isExpired is false before the deadline, true at/after it", () => {
    const deadline = computeDeadline(1000, 30_000);
    expect(isExpired(deadline, 30_999)).toBe(false);
    expect(isExpired(deadline, 31_000)).toBe(true);
    expect(isExpired(deadline, 40_000)).toBe(true);
  });

  it("remainingMs never goes negative", () => {
    const deadline = computeDeadline(0, 10_000);
    expect(remainingMs(deadline, 5_000)).toBe(5_000);
    expect(remainingMs(deadline, 15_000)).toBe(0);
  });
});
