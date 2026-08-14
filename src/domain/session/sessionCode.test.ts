import { describe, expect, it } from "vitest";
import { generateSessionCode } from "./sessionCode";

describe("generateSessionCode", () => {
  it("is 6 characters, uppercase, no ambiguous characters", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateSessionCode();
      expect(code).toHaveLength(6);
      expect(code).toMatch(/^[A-Z0-9]+$/);
      expect(code).not.toMatch(/[01IOL]/);
    }
  });

  it("is deterministic given a fixed random source", () => {
    const fixed = () => 0; // always picks the alphabet's first character
    expect(generateSessionCode(fixed)).toBe(generateSessionCode(fixed));
  });
});
