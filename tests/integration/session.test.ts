import { afterAll, describe, expect, it } from "vitest";
import { createSession, finishSession, getSessionState } from "@/server/db/session";
import { joinSession, resolveParticipantByToken } from "@/server/db/participant";
import { SessionError } from "@/domain/session";
import { prisma } from "@/server/db/client";

/**
 * Real session/participant coverage — the normal cases AND the race
 * conditions AGENTS.md's "Session invariants" promise are impossible, not
 * just unlikely. These call the exact functions the tRPC session router
 * calls (see src/server/trpc/router.ts) — no HTTP layer needed to
 * exercise the real business logic and the real Postgres constraints.
 */
describe("Session + Participant", () => {
  const createdSessionIds = new Set<string>();

  afterAll(async () => {
    await prisma.session.deleteMany({ where: { id: { in: Array.from(createdSessionIds) } } });
    await prisma.$disconnect();
  });

  async function freshSession() {
    const session = await createSession();
    createdSessionIds.add(session.id);
    return session;
  }

  it("creates a session with a unique code and CREATED status", async () => {
    const session = await freshSession();
    expect(session.code).toHaveLength(6);
    expect(session.status).toBe("CREATED");
  });

  it("joining moves the session from CREATED to ACTIVE", async () => {
    const session = await freshSession();
    await joinSession({ sessionCode: session.code, role: "HOST", displayName: "Host" });
    const state = await getSessionState(session.code);
    expect(state.status).toBe("ACTIVE");
  });

  it("a host can join and is reflected in session state", async () => {
    const session = await freshSession();
    await joinSession({ sessionCode: session.code, role: "HOST", displayName: "Alex" });
    const state = await getSessionState(session.code);
    expect(state.host).toEqual({ displayName: "Alex" });
    expect(state.capacity.hostAvailable).toBe(false);
  });

  it("rejects a second host with HOST_ALREADY_CONNECTED", async () => {
    const session = await freshSession();
    await joinSession({ sessionCode: session.code, role: "HOST", displayName: "Alex" });

    await expect(joinSession({ sessionCode: session.code, role: "HOST", displayName: "Someone else" })).rejects.toMatchObject(
      { code: "HOST_ALREADY_CONNECTED" },
    );
  });

  it("fills team A up to 2 players and assigns seats 1 and 2", async () => {
    const session = await freshSession();
    await joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "A1" });
    await joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "A2" });

    const state = await getSessionState(session.code);
    expect(state.teamA.map((p) => p.seat)).toEqual([1, 2]);
    expect(state.capacity.teamASlotsRemaining).toBe(0);
  });

  it("rejects a 3rd player on team A with TEAM_FULL", async () => {
    const session = await freshSession();
    await joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "A1" });
    await joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "A2" });

    await expect(joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "A3" })).rejects.toMatchObject(
      { code: "TEAM_FULL" },
    );
  });

  it("rejects a 3rd player on team B with TEAM_FULL, independently of team A", async () => {
    const session = await freshSession();
    await joinSession({ sessionCode: session.code, role: "TEAM_B", displayName: "B1" });
    await joinSession({ sessionCode: session.code, role: "TEAM_B", displayName: "B2" });

    await expect(joinSession({ sessionCode: session.code, role: "TEAM_B", displayName: "B3" })).rejects.toMatchObject(
      { code: "TEAM_FULL" },
    );
  });

  it("allows exactly 4 players total (2 per team) plus 1 host", async () => {
    const session = await freshSession();
    await joinSession({ sessionCode: session.code, role: "HOST", displayName: "Host" });
    await joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "A1" });
    await joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "A2" });
    await joinSession({ sessionCode: session.code, role: "TEAM_B", displayName: "B1" });
    await joinSession({ sessionCode: session.code, role: "TEAM_B", displayName: "B2" });

    const state = await getSessionState(session.code);
    expect(state.teamA).toHaveLength(2);
    expect(state.teamB).toHaveLength(2);
    expect(state.host?.displayName).toBe("Host");
  });

  it("tolerates multiple DISPLAY connections without counting them as players", async () => {
    const session = await freshSession();
    await joinSession({ sessionCode: session.code, role: "DISPLAY", displayName: "OBS 1" });
    await joinSession({ sessionCode: session.code, role: "DISPLAY", displayName: "OBS 2" });
    await joinSession({ sessionCode: session.code, role: "DISPLAY", displayName: "OBS 3" });

    const state = await getSessionState(session.code);
    expect(state.displayCount).toBe(3);
    expect(state.teamA).toHaveLength(0);
    expect(state.teamB).toHaveLength(0);
  });

  it("re-joining with an existing valid token is idempotent (no duplicate seat)", async () => {
    const session = await freshSession();
    const first = await joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "A1" });
    const second = await joinSession({
      sessionCode: session.code,
      role: "TEAM_A",
      displayName: "A1",
      token: first.token,
    });

    expect(second.reused).toBe(true);
    expect(second.token).toBe(first.token);

    const state = await getSessionState(session.code);
    expect(state.teamA).toHaveLength(1);
  });

  it("rejects joining a session that doesn't exist", async () => {
    await expect(
      joinSession({ sessionCode: "NOSUCH", role: "HOST", displayName: "Alex" }),
    ).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" });
  });

  it("rejects joining a finished session", async () => {
    const session = await freshSession();
    await joinSession({ sessionCode: session.code, role: "HOST", displayName: "Host" });
    await finishSession(session.id);

    await expect(
      joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "A1" }),
    ).rejects.toMatchObject({ code: "SESSION_CLOSED" });
  });

  it("getSessionState rejects an unknown session code", async () => {
    await expect(getSessionState("NOSUCH")).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" });
  });

  it("resolveParticipantByToken rejects an invalid token", async () => {
    await expect(resolveParticipantByToken("not-a-real-token")).rejects.toMatchObject({ code: "INVALID_TOKEN" });
  });

  it("resolveParticipantByToken rejects a token for a finished session", async () => {
    const session = await freshSession();
    const join = await joinSession({ sessionCode: session.code, role: "HOST", displayName: "Host" });
    await finishSession(session.id);

    await expect(resolveParticipantByToken(join.token)).rejects.toMatchObject({ code: "SESSION_CLOSED" });
  });

  it("a second session.finish with the same host token fails predictably, and getSessionState keeps working (Quick Demo Reset repro)", async () => {
    // Mirrors the tRPC `session.finish` handler exactly: resolve the
    // token, then finish. Calling that twice in a row — e.g. a stale demo
    // record surviving in a second tab, or a double click before the
    // button's `loading` state paints — is the scenario reported against
    // the Quick Demo's Reset button: first call must succeed, the second
    // must fail with a stable, expected SESSION_CLOSED (not loop, not
    // throw something unclassified), and session.getState must keep
    // answering normally afterward rather than getting stuck or erroring.
    const session = await freshSession();
    const host = await joinSession({ sessionCode: session.code, role: "HOST", displayName: "Host" });

    const first = await resolveParticipantByToken(host.token);
    await finishSession(first.sessionId);

    await expect(resolveParticipantByToken(host.token)).rejects.toMatchObject({ code: "SESSION_CLOSED" });
    await expect(resolveParticipantByToken(host.token)).rejects.toMatchObject({ code: "SESSION_CLOSED" });

    const state = await getSessionState(session.code);
    expect(state.status).toBe("FINISHED");
  });

  describe("concurrency", () => {
    it("two simultaneous joins for the last team seat: exactly one succeeds, one gets TEAM_FULL", async () => {
      const session = await freshSession();
      await joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "A1" }); // 1 seat left

      const results = await Promise.allSettled([
        joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "A2" }),
        joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "A3" }),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: "TEAM_FULL" });

      const state = await getSessionState(session.code);
      expect(state.teamA).toHaveLength(2); // never 3
    });

    it("two simultaneous joins for an empty team (both racing for seat 1): exactly one succeeds", async () => {
      const session = await freshSession();

      const results = await Promise.allSettled([
        joinSession({ sessionCode: session.code, role: "TEAM_B", displayName: "B1" }),
        joinSession({ sessionCode: session.code, role: "TEAM_B", displayName: "B2" }),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      expect(fulfilled).toHaveLength(1);

      const state = await getSessionState(session.code);
      expect(state.teamB).toHaveLength(1);
    });

    it("two simultaneous host joins: exactly one becomes host", async () => {
      const session = await freshSession();

      const results = await Promise.allSettled([
        joinSession({ sessionCode: session.code, role: "HOST", displayName: "Alex" }),
        joinSession({ sessionCode: session.code, role: "HOST", displayName: "Sam" }),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: "HOST_ALREADY_CONNECTED" });

      const state = await getSessionState(session.code);
      expect(state.host).not.toBeNull();
    });

    it("four simultaneous joins for a 2-seat team: exactly 2 succeed", async () => {
      const session = await freshSession();

      const results = await Promise.allSettled([
        joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "A1" }),
        joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "A2" }),
        joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "A3" }),
        joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "A4" }),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      expect(fulfilled).toHaveLength(2);

      const state = await getSessionState(session.code);
      expect(state.teamA).toHaveLength(2);
      // Seats are never duplicated even under the race.
      expect(new Set(state.teamA.map((p) => p.seat)).size).toBe(2);
    });
  });
});

// SessionError doesn't serialize with `.code` via plain equality checks in
// some matchers, so a couple of tests assert shape via toMatchObject
// against the thrown value directly — sanity-check that actually works.
describe("SessionError shape", () => {
  it("exposes a `code` property matchable by toMatchObject", () => {
    const error = new SessionError("TEAM_FULL");
    expect(error).toMatchObject({ code: "TEAM_FULL" });
  });
});
