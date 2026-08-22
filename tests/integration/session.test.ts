import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { createSocketServer } from "@/server/sockets";
import { createSession, endSession, getSessionState } from "@/server/db/session";
import { joinSession, kickParticipant, reclaimHost, resolveParticipantByToken } from "@/server/db/participant";
import { broadcastParticipantKicked } from "@/server/sockets/session";
import { getSocketServer } from "@/server/sockets/instance";
import { SessionError } from "@/domain/session";
import { prisma } from "@/server/db/client";

/**
 * Real session/participant coverage — the normal cases AND the race
 * conditions AGENTS.md's "Session invariants" promise are impossible, not
 * just unlikely. These call the exact functions the tRPC session router
 * calls (see src/server/trpc/router.ts) — no HTTP layer needed to
 * exercise the real business logic and the real Postgres constraints.
 *
 * Runs a real Socket.IO server alongside the direct DB calls (same shape
 * as game-socket.test.ts) because joinSession now genuinely depends on
 * live host presence (src/server/sockets/presence.ts's isHostConnected)
 * for any non-host role — there's no way to exercise that rule honestly
 * without a real connected socket; faking the presence map would just be
 * testing a mock of the thing this file exists to verify.
 */
describe("Session + Participant", () => {
  const createdSessionIds = new Set<string>();
  let baseUrl: string;
  let httpServer: ReturnType<typeof createServer>;
  const openSockets: ClientSocket[] = [];

  beforeAll(async () => {
    httpServer = createServer();
    createSocketServer(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const { port } = httpServer.address() as AddressInfo;
    baseUrl = `http://localhost:${port}`;
  });

  afterAll(async () => {
    openSockets.forEach((s) => s.close());
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await prisma.session.deleteMany({ where: { id: { in: Array.from(createdSessionIds) } } });
    await prisma.$disconnect();
  });

  async function freshSession() {
    const session = await createSession();
    createdSessionIds.add(session.id);
    return session;
  }

  function connectSocket(token: string): ClientSocket {
    const socket = ioClient(baseUrl, { path: "/socket.io", auth: { token }, transports: ["websocket"], forceNew: true });
    openSockets.push(socket);
    return socket;
  }
  function waitForConnect(socket: ClientSocket) {
    return new Promise<void>((resolve) => socket.on("connect", () => resolve()));
  }

  /**
   * The client's "connect" event firing does NOT guarantee the server has
   * finished registerPresenceHandlers' synchronous body for that socket —
   * under load (this whole file's worth of sockets/timers), there's a
   * real gap between "handshake acked" and "presence map updated" wide
   * enough for an immediately-following join to occasionally lose the
   * race and see stale (not-yet-registered) presence. The server always
   * emits the socket its own presence:update right after registering
   * (see presence.ts) — waiting for that specific echo, not just
   * "connected", is the actual guarantee this file's tests need. The
   * listener has to be attached in the SAME synchronous tick the socket
   * is created (before any `await`), or the event can already have fired
   * — with no listener yet subscribed — before this function is even
   * called, hanging forever on a second event that never comes.
   */
  function connectAndWaitForPresence(token: string): { socket: ClientSocket; ready: Promise<void> } {
    const socket = connectSocket(token);
    const ready = new Promise<void>((resolve) => socket.once("presence:update", () => resolve()));
    return { socket, ready };
  }

  /** A session with a HOST that's genuinely connected (real socket, real presence) — what any non-host join now requires to succeed. */
  async function freshSessionWithHost() {
    const session = await freshSession();
    const host = await joinSession({ sessionCode: session.code, role: "HOST", displayName: "Host" });
    const { socket: hostSocket, ready } = connectAndWaitForPresence(host.token);
    await ready;
    return { session, host, hostSocket };
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
    expect(state.host).toMatchObject({ displayName: "Alex" });
    expect(state.host?.id).toBeTruthy();
    expect(state.capacity.hostAvailable).toBe(false);
  });

  it("rejects a second host with HOST_ALREADY_CONNECTED", async () => {
    const session = await freshSession();
    await joinSession({ sessionCode: session.code, role: "HOST", displayName: "Alex" });

    await expect(joinSession({ sessionCode: session.code, role: "HOST", displayName: "Someone else" })).rejects.toMatchObject(
      { code: "HOST_ALREADY_CONNECTED" },
    );
  });

  describe("HOST_NOT_CONNECTED — a session code alone is never enough", () => {
    it("rejects a Player joining a session whose host never connected", async () => {
      const session = await freshSession(); // no host join at all
      await expect(
        joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "A1" }),
      ).rejects.toMatchObject({ code: "HOST_NOT_CONNECTED" });
    });

    it("rejects a Display joining a session whose host never connected", async () => {
      const session = await freshSession();
      await expect(
        joinSession({ sessionCode: session.code, role: "DISPLAY", displayName: "OBS" }),
      ).rejects.toMatchObject({ code: "HOST_NOT_CONNECTED" });
    });

    it("rejects a Player even when a host row exists in the DB but isn't actually connected (a socket, not a DB flag, is the real fact)", async () => {
      const session = await freshSession();
      await joinSession({ sessionCode: session.code, role: "HOST", displayName: "Host" }); // DB row only, no socket
      await expect(
        joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "A1" }),
      ).rejects.toMatchObject({ code: "HOST_NOT_CONNECTED" });
    });

    it("allows a Player to join once the host is genuinely connected", async () => {
      const { session } = await freshSessionWithHost();
      const joined = await joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "A1" });
      expect(joined.role).toBe("TEAM_A");
    });

    it("a host disconnecting blocks new joins; a host reconnecting restores them", async () => {
      const { session, host, hostSocket } = await freshSessionWithHost();

      const okBeforeDisconnect = await joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "A1" });
      expect(okBeforeDisconnect.role).toBe("TEAM_A");

      hostSocket.close();
      await new Promise((resolve) => setTimeout(resolve, 150)); // let the server's disconnect handler run

      await expect(
        joinSession({ sessionCode: session.code, role: "TEAM_B", displayName: "B1" }),
      ).rejects.toMatchObject({ code: "HOST_NOT_CONNECTED" });

      // The player who already joined stays a real, resolvable participant — a
      // host disconnect never touches existing seats.
      await expect(resolveParticipantByToken(okBeforeDisconnect.token)).resolves.toMatchObject({ role: "TEAM_A" });

      // Host reconnects (same token, fresh socket) — new joins work again.
      const { ready: hostReconnectedReady } = connectAndWaitForPresence(host.token);
      await hostReconnectedReady;
      const okAfterReconnect = await joinSession({ sessionCode: session.code, role: "TEAM_B", displayName: "B1" });
      expect(okAfterReconnect.role).toBe("TEAM_B");
    });

    it("reconnecting with an already-valid token is NOT gated by host presence — only fresh joins are", async () => {
      const { session, hostSocket } = await freshSessionWithHost();
      const player = await joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "A1" });

      hostSocket.close();
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Same player, same token, host currently down — this is a reconnect, not a new seat.
      const reconnected = await joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "A1", token: player.token });
      expect(reconnected.reused).toBe(true);
      expect(reconnected.token).toBe(player.token);
    });
  });

  it("fills team A up to 2 players and assigns seats 1 and 2", async () => {
    const { session } = await freshSessionWithHost();
    await joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "A1" });
    await joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "A2" });

    const state = await getSessionState(session.code);
    expect(state.teamA.map((p) => p.seat)).toEqual([1, 2]);
    expect(state.capacity.teamASlotsRemaining).toBe(0);
  });

  it("rejects a 3rd player on team A with TEAM_FULL", async () => {
    const { session } = await freshSessionWithHost();
    await joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "A1" });
    await joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "A2" });

    await expect(joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "A3" })).rejects.toMatchObject(
      { code: "TEAM_FULL" },
    );
  });

  it("rejects a 3rd player on team B with TEAM_FULL, independently of team A", async () => {
    const { session } = await freshSessionWithHost();
    await joinSession({ sessionCode: session.code, role: "TEAM_B", displayName: "B1" });
    await joinSession({ sessionCode: session.code, role: "TEAM_B", displayName: "B2" });

    await expect(joinSession({ sessionCode: session.code, role: "TEAM_B", displayName: "B3" })).rejects.toMatchObject(
      { code: "TEAM_FULL" },
    );
  });

  it("allows exactly 4 players total (2 per team) plus 1 host", async () => {
    const { session } = await freshSessionWithHost();
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
    const { session } = await freshSessionWithHost();
    await joinSession({ sessionCode: session.code, role: "DISPLAY", displayName: "OBS 1" });
    await joinSession({ sessionCode: session.code, role: "DISPLAY", displayName: "OBS 2" });
    await joinSession({ sessionCode: session.code, role: "DISPLAY", displayName: "OBS 3" });

    const state = await getSessionState(session.code);
    expect(state.displayCount).toBe(3);
    expect(state.teamA).toHaveLength(0);
    expect(state.teamB).toHaveLength(0);
  });

  it("re-joining with an existing valid token is idempotent (no duplicate seat)", async () => {
    const { session } = await freshSessionWithHost();
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

  it("rejects joining a session that was ended (the row survives, marked FINISHED)", async () => {
    const session = await freshSession();
    await joinSession({ sessionCode: session.code, role: "HOST", displayName: "Host" });
    await endSession(session.id);

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

  it("resolveParticipantByToken rejects a token for an ended session (the participant row survives, the session is just closed)", async () => {
    const session = await freshSession();
    const join = await joinSession({ sessionCode: session.code, role: "HOST", displayName: "Host" });
    await endSession(session.id);

    await expect(resolveParticipantByToken(join.token)).rejects.toMatchObject({ code: "SESSION_CLOSED" });
  });

  it("a second session.finish with the same host token fails predictably, and getSessionState reflects the session being FINISHED (Quick Demo Reset repro)", async () => {
    // Mirrors the tRPC `session.finish` handler exactly: resolve the
    // token, then end. Calling that twice in a row — e.g. a stale demo
    // record surviving in a second tab, or a double click before the
    // button's `loading` state paints — is the scenario reported against
    // the Quick Demo's Reset button: first call must succeed, the second
    // must fail with a stable, expected SESSION_CLOSED (the session's
    // own status is what's checked, not loop, not throw something
    // unclassified), and session.getState must keep resolving with
    // `status: "FINISHED"` afterward rather than getting stuck, erroring
    // unclassified, or pretending the session never ended.
    const session = await freshSession();
    const host = await joinSession({ sessionCode: session.code, role: "HOST", displayName: "Host" });

    const first = await resolveParticipantByToken(host.token);
    await endSession(first.sessionId);

    await expect(resolveParticipantByToken(host.token)).rejects.toMatchObject({ code: "SESSION_CLOSED" });
    await expect(resolveParticipantByToken(host.token)).rejects.toMatchObject({ code: "SESSION_CLOSED" });

    await expect(getSessionState(session.code)).resolves.toMatchObject({ status: "FINISHED" });
  });

  it("rejects a new join once the session has been ended, even with a genuinely connected host socket still open", async () => {
    const { session, host, hostSocket } = await freshSessionWithHost();
    await endSession((await resolveParticipantByToken(host.token)).sessionId);

    await expect(
      joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "A1" }),
    ).rejects.toMatchObject({ code: "SESSION_CLOSED" });

    hostSocket.close();
  });

  describe("reclaimHost — recovering the HOST seat without the original token", () => {
    it("rotates the host's token given the correct recovery key", async () => {
      const session = await freshSession();
      const host = await joinSession({ sessionCode: session.code, role: "HOST", displayName: "Alex" });

      const reclaimed = await reclaimHost({ sessionCode: session.code, hostKey: session.hostKey, displayName: "Alex" });
      expect(reclaimed.role).toBe("HOST");
      expect(reclaimed.token).not.toBe(host.token);

      // The old token is dead — reclaiming rotates the seat's token, it doesn't add a second one.
      await expect(resolveParticipantByToken(host.token)).rejects.toMatchObject({ code: "INVALID_TOKEN" });
      await expect(resolveParticipantByToken(reclaimed.token)).resolves.toMatchObject({ role: "HOST" });
    });

    it("still works while other participants are connected — the game keeps running", async () => {
      const { session } = await freshSessionWithHost();
      const player = await joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "A1" });

      const reclaimed = await reclaimHost({ sessionCode: session.code, hostKey: session.hostKey, displayName: "Alex again" });
      expect(reclaimed.role).toBe("HOST");

      // The already-seated player is untouched by the host's recovery.
      await expect(resolveParticipantByToken(player.token)).resolves.toMatchObject({ role: "TEAM_A" });
    });

    it("rejects the wrong recovery key with INVALID_HOST_KEY", async () => {
      const session = await freshSession();
      await joinSession({ sessionCode: session.code, role: "HOST", displayName: "Alex" });

      await expect(
        reclaimHost({ sessionCode: session.code, hostKey: "WRNG-WRNG-WRNG", displayName: "Alex" }),
      ).rejects.toMatchObject({ code: "INVALID_HOST_KEY" });
    });

    it("rejects an unknown session code with SESSION_NOT_FOUND", async () => {
      await expect(
        reclaimHost({ sessionCode: "NOSUCH", hostKey: "AAAA-AAAA-AAAA", displayName: "Alex" }),
      ).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" });
    });

    it("rejects an ended session with SESSION_CLOSED, even with the correct key", async () => {
      const session = await freshSession();
      const host = await joinSession({ sessionCode: session.code, role: "HOST", displayName: "Alex" });
      await endSession((await resolveParticipantByToken(host.token)).sessionId);

      await expect(
        reclaimHost({ sessionCode: session.code, hostKey: session.hostKey, displayName: "Alex" }),
      ).rejects.toMatchObject({ code: "SESSION_CLOSED" });
    });
  });

  describe("concurrency", () => {
    it("two simultaneous joins for the last team seat: exactly one succeeds, one gets TEAM_FULL", async () => {
      const { session } = await freshSessionWithHost();
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
      const { session } = await freshSessionWithHost();

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

    it("four simultaneous joins for a 2-seat team: never more than 2 succeed, seats never duplicate", async () => {
      // NOT "exactly 2" — joinSession has no retry-on-conflict (unlike
      // the Game Kernel's applyGameAction), so this is a genuine SAFETY
      // guarantee (never over-allocate, never duplicate a seat), not a
      // LIVENESS one. If all 4 attempts read teamCount=0 before any of
      // them commits, all 4 can legitimately compute the same next seat
      // and only the single winner survives the unique constraint — the
      // other 3 (not just 2) correctly fail with TEAM_FULL. See the
      // "two simultaneous joins for an empty team" test above, which
      // already documents/accepts this exact class of outcome for a
      // smaller count.
      const { session } = await freshSessionWithHost();

      const results = await Promise.allSettled([
        joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "A1" }),
        joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "A2" }),
        joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "A3" }),
        joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "A4" }),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      expect(fulfilled.length).toBeGreaterThanOrEqual(1);
      expect(fulfilled.length).toBeLessThanOrEqual(2); // never more than the team's real capacity

      const state = await getSessionState(session.code);
      expect(state.teamA.length).toBeLessThanOrEqual(2);
      expect(state.teamA.length).toBe(fulfilled.length);
      // Seats are never duplicated even under the race, whatever the actual count turned out to be.
      expect(new Set(state.teamA.map((p) => p.seat)).size).toBe(state.teamA.length);
    });

    it("a Player's join races the host's own connection landing — either a clean HOST_NOT_CONNECTED or a real seat, never a corrupt state", async () => {
      const session = await freshSession();
      const host = await joinSession({ sessionCode: session.code, role: "HOST", displayName: "Host" });
      const hostSocket = connectSocket(host.token);

      // Deliberately not awaiting the host's connect before firing the
      // player's join — whichever lands first, the outcome must be one
      // of exactly two clean results, never a corrupted/partial one.
      const [connectResult, joinResult] = await Promise.allSettled([
        waitForConnect(hostSocket),
        joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "A1" }),
      ]);
      expect(connectResult.status).toBe("fulfilled");

      if (joinResult.status === "fulfilled") {
        expect(joinResult.value.role).toBe("TEAM_A");
      } else {
        expect(joinResult.reason).toMatchObject({ code: "HOST_NOT_CONNECTED" });
      }

      const state = await getSessionState(session.code);
      expect(state.teamA.length).toBeLessThanOrEqual(1); // never duplicated, whichever branch actually happened
    });

    it("several different players joining the moment the host connects: all succeed, none wrongly gated", async () => {
      // Non-colliding seats on purpose (one join per team, plus two
      // DISPLAYs which never contend for a seat at all) — the seat-number
      // race under true concurrency is already covered exhaustively by
      // the "two/four simultaneous joins" tests above; mixing in a
      // second same-team attempt here would just re-trigger that same
      // already-documented, already-accepted race (whichever concurrent
      // insert loses hits the seat unique constraint and surfaces as
      // TEAM_FULL — a safety guarantee, not a liveness one; see
      // joinSession's own doc comment). This test isolates a different,
      // genuinely new question: does the host-connected gate ever wrongly
      // reject a legitimate join just because several land at once?
      const session = await freshSession();
      const host = await joinSession({ sessionCode: session.code, role: "HOST", displayName: "Host" });
      const { ready } = connectAndWaitForPresence(host.token);
      await ready;

      const results = await Promise.allSettled([
        joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "A1" }),
        joinSession({ sessionCode: session.code, role: "TEAM_B", displayName: "B1" }),
        joinSession({ sessionCode: session.code, role: "DISPLAY", displayName: "OBS 1" }),
        joinSession({ sessionCode: session.code, role: "DISPLAY", displayName: "OBS 2" }),
      ]);

      const rejected = results.filter((r) => r.status === "rejected");
      expect(rejected).toEqual([]); // host was connected throughout — nothing here should ever be gated

      const state = await getSessionState(session.code);
      expect(state.teamA).toHaveLength(1);
      expect(state.teamB).toHaveLength(1);
      expect(state.displayCount).toBe(2);
    });
  });

  describe("kickParticipant — the Host forcibly freeing a seat", () => {
    it("removes the participant; their old token stops resolving", async () => {
      const { session } = await freshSessionWithHost();
      const a1 = await joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "A1" });

      const kicked = await kickParticipant(session.id, a1.id);
      expect(kicked).toEqual({ role: "TEAM_A", displayName: "A1" });

      await expect(resolveParticipantByToken(a1.token)).rejects.toMatchObject({ code: "INVALID_TOKEN" });
    });

    it("frees the seat for a genuinely new join, even when the REMAINING seat isn't seat 1 (the gap this exists to close)", async () => {
      const { session } = await freshSessionWithHost();
      // seat 1
      const a1 = await joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "A1" });
      // seat 2 — MAX_PLAYERS_PER_TEAM is 2, so the team is now full
      await joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "A2" });
      await expect(
        joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "A3" }),
      ).rejects.toMatchObject({ code: "TEAM_FULL" });

      // Kick whoever holds the LOWER seat, leaving only the higher one —
      // the exact shape that broke the old `count + 1` seat assignment
      // (it would recompute the same taken seat number and hit the
      // unique constraint instead of reusing the freed one).
      await kickParticipant(session.id, a1.id);

      const rejoined = await joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "A3" });
      expect(rejoined.role).toBe("TEAM_A");

      const state = await getSessionState(session.code);
      expect(state.teamA).toHaveLength(2); // the seat was reused, not stacked on top
    });

    it("rejects kicking the HOST", async () => {
      const { session, host } = await freshSessionWithHost();
      await expect(kickParticipant(session.id, host.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("rejects an unknown participant id", async () => {
      const { session } = await freshSessionWithHost();
      await expect(kickParticipant(session.id, "not-a-real-id")).rejects.toMatchObject({ code: "PARTICIPANT_NOT_FOUND" });
    });

    it("scopes to the caller's own session — can't kick a participant that belongs to a DIFFERENT session (IDOR)", async () => {
      const { session: sessionA } = await freshSessionWithHost();
      const { session: sessionB } = await freshSessionWithHost();
      const bPlayer = await joinSession({ sessionCode: sessionB.code, role: "TEAM_A", displayName: "B-player" });

      await expect(kickParticipant(sessionA.id, bPlayer.id)).rejects.toMatchObject({ code: "PARTICIPANT_NOT_FOUND" });
      // Untouched — the rejected cross-session attempt didn't reach it.
      await expect(resolveParticipantByToken(bPlayer.token)).resolves.toMatchObject({ role: "TEAM_A" });
    });

    it("kicking an already-kicked participant fails with a clear PARTICIPANT_NOT_FOUND, not a crash", async () => {
      const { session } = await freshSessionWithHost();
      const a1 = await joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "A1" });
      await kickParticipant(session.id, a1.id);
      await expect(kickParticipant(session.id, a1.id)).rejects.toMatchObject({ code: "PARTICIPANT_NOT_FOUND" });
    });

    it("real-time: the kicked participant's own socket receives participant:kicked and is disconnected — nothing else broadcasts to it", async () => {
      const { session } = await freshSessionWithHost();
      const a1 = await joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "A1" });
      const { socket, ready } = connectAndWaitForPresence(a1.token);
      await ready;

      const kickedEvent = new Promise<void>((resolve) => socket.once("participant:kicked", () => resolve()));
      const disconnected = new Promise<void>((resolve) => socket.once("disconnect", () => resolve()));

      await kickParticipant(session.id, a1.id);
      const io = getSocketServer();
      if (!io) throw new Error("expected a live Socket.IO server in this test file");
      broadcastParticipantKicked(io, a1.id);

      await kickedEvent;
      await disconnected;
    });
  });

  describe("joinSession — reclaim-by-name for a returning TEAM_A/TEAM_B player with no token", () => {
    it("hands back the SAME seat when the old holder isn't currently connected", async () => {
      const { session } = await freshSessionWithHost();
      const first = await joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "Jamie" });
      // No socket ever opened for `first` — genuinely "not connected",
      // the exact scenario a closed tab / a different device leaves behind.

      const second = await joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "Jamie" });
      expect(second.id).toBe(first.id); // same participant, not a second seat
      expect(second.reused).toBe(true);
      expect(second.token).not.toBe(first.token); // a real new token — the old one is dead now

      await expect(resolveParticipantByToken(first.token)).rejects.toMatchObject({ code: "INVALID_TOKEN" });
      await expect(resolveParticipantByToken(second.token)).resolves.toMatchObject({ participantId: first.id });

      const state = await getSessionState(session.code);
      expect(state.teamA).toHaveLength(1); // never became two seats
    });

    it("does NOT steal the seat while the original holder is genuinely still connected — a second same-name join gets its own seat instead", async () => {
      const { session } = await freshSessionWithHost();
      const first = await joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "Jamie" });
      const { ready } = connectAndWaitForPresence(first.token);
      await ready;

      const second = await joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "Jamie" });
      expect(second.id).not.toBe(first.id);
      expect(second.reused).toBe(false);

      // First seat is untouched and still real.
      await expect(resolveParticipantByToken(first.token)).resolves.toMatchObject({ participantId: first.id });

      const state = await getSessionState(session.code);
      expect(state.teamA).toHaveLength(2);
    });

    it("a genuinely full team (2 present, 0 disconnected) still rejects a third join with TEAM_FULL", async () => {
      const { session } = await freshSessionWithHost();
      await joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "Jamie" });
      await joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "Alex" });

      await expect(
        joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "Someone else" }),
      ).rejects.toMatchObject({ code: "TEAM_FULL" });
    });

    it("a DIFFERENT display name never reclaims someone else's disconnected seat — it claims its own free one normally", async () => {
      const { session } = await freshSessionWithHost();
      const jamie = await joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "Jamie" });
      // Jamie never connects — genuinely offline, same as the reclaim test above.

      const alex = await joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "Alex" });
      expect(alex.id).not.toBe(jamie.id);
      expect(alex.reused).toBe(false);

      const state = await getSessionState(session.code);
      expect(state.teamA).toHaveLength(2); // Jamie's stale seat is still there, untouched, alongside Alex's new one
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
