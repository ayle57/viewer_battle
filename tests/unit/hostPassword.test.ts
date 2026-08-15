import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEV_PLAYGROUND_HOST_PASSWORD } from "@/domain/session";
import { verifyHostPassword } from "@/server/auth/hostPassword";

/**
 * verifyHostPassword gates session.create (src/server/trpc/router.ts) —
 * see AGENTS.md "Host recovery" and hostPassword.ts's own doc comment.
 * Env-var-driven, so every test pins the env explicitly via vi.stubEnv
 * (NODE_ENV is typed read-only on process.env — a direct assignment
 * fails tsc, vi.stubEnv is the sanctioned way around that) rather than
 * relying on whatever tests/setup.ts's real `.env` happens to contain.
 */
describe("verifyHostPassword", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("NODE_ENV", "production"); // off by default — each test opts into the dev shortcut explicitly
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts the exact configured password", () => {
    vi.stubEnv("HOST_PASSWORD", "correct-horse-battery-staple");
    expect(verifyHostPassword("correct-horse-battery-staple")).toBe(true);
  });

  it("rejects a wrong password", () => {
    vi.stubEnv("HOST_PASSWORD", "correct-horse-battery-staple");
    expect(verifyHostPassword("wrong-password")).toBe(false);
  });

  it("rejects a candidate of a different length without throwing", () => {
    vi.stubEnv("HOST_PASSWORD", "correct-horse-battery-staple");
    expect(verifyHostPassword("short")).toBe(false);
    expect(verifyHostPassword("")).toBe(false);
  });

  it("fails closed when HOST_PASSWORD isn't configured at all", () => {
    vi.stubEnv("HOST_PASSWORD", undefined);
    expect(verifyHostPassword("anything")).toBe(false);
    expect(verifyHostPassword("")).toBe(false);
  });

  it("accepts the fixed dev-playground password outside production, even with no real password configured", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("HOST_PASSWORD", undefined);
    expect(verifyHostPassword(DEV_PLAYGROUND_HOST_PASSWORD)).toBe(true);
  });

  it("never accepts the dev-playground password in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("HOST_PASSWORD", "correct-horse-battery-staple");
    expect(verifyHostPassword(DEV_PLAYGROUND_HOST_PASSWORD)).toBe(false);
  });
});
