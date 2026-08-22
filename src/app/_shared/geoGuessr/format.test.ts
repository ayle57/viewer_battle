import { describe, expect, it } from "vitest";
import { formatDistance } from "./format";

describe("formatDistance", () => {
  it("renders as a percentage-off string, not a fabricated real-world unit", () => {
    expect(formatDistance(0.084)).toBe("8.4% off");
    expect(formatDistance(0)).toBe("0.0% off");
  });

  it("renders 'No guess' for a team that genuinely never answered (a countdown-forced round close)", () => {
    expect(formatDistance(null)).toBe("No guess");
  });
});
