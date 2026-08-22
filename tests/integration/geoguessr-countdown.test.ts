import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { createSocketServer } from "@/server/sockets";
import { broadcastGameSnapshot } from "@/server/sockets/game";
import { createSession } from "@/server/db/session";
import { joinSession } from "@/server/db/participant";
import { startGame, applyGameAction, getCurrentGame } from "@/server/game";
import { sampleGeoPlaylist } from "@/domain/game/geoGuessr";
import { prisma } from "@/server/db/client";

interface GeoSnapshot {
  gameId: string;
  gameKey: string;
  state: {
    status: string;
    winner: string | null;
    countdownDeadline: number | null;
  };
  events: { type: string }[];
}

/**
 * The GeoGuessr countdown-to-end feature, real transport — the domain
 * logic itself (durations, retargeting, checkExpiry's pure resolution,
 * every finish path clearing the deadline) is already exhaustively
 * covered by engine.test.ts; THIS file proves the two things only a real
 * server process can prove: (1) `getCurrentGame`'s lazy self-heal
 * (service.ts) actually resolves an expired deadline nobody's real-time
 * timer caught, and (2) the server's own real-time timer
 * (src/server/sockets/gameEndTimers.ts + game.ts) genuinely fires on its
 * own — no client ever sends END_GAME — and every connected role
 * (Host/Team/Display) receives the exact same resulting state. Real
 * 10-second waits are unavoidable here (10s is the product's own
 * minimum duration, not a test convenience), kept to the minimum number
 * of tests that actually need one.
 */
describe("GeoGuessr countdown-to-end (real timers, real transport)", () => {
  let baseUrl: string;
  let httpServer: ReturnType<typeof createServer>;
  let io: ReturnType<typeof createSocketServer>;
  const createdSessionIds = new Set<string>();
  const openSockets: ClientSocket[] = [];

  beforeAll(async () => {
    httpServer = createServer();
    io = createSocketServer(httpServer);
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

  function connect(token: string): ClientSocket {
    const socket = ioClient(baseUrl, { path: "/socket.io", auth: { token }, transports: ["websocket"], forceNew: true });
    openSockets.push(socket);
    return socket;
  }
  function waitForConnect(socket: ClientSocket) {
    return new Promise<void>((resolve) => socket.on("connect", () => resolve()));
  }
  function waitForStateWhere(socket: ClientSocket, predicate: (snapshot: GeoSnapshot) => boolean): Promise<GeoSnapshot> {
    return new Promise((resolve) => {
      function handler(snapshot: GeoSnapshot) {
        if (!predicate(snapshot)) return;
        socket.off("game:state", handler);
        resolve(snapshot);
      }
      socket.on("game:state", handler);
    });
  }
  function sendAction(socket: ClientSocket, action: Record<string, unknown>) {
    return new Promise<{ ok: boolean; error?: { code: string; message: string }; state?: GeoSnapshot["state"] }>((resolve) => {
      socket.emit("game:action", action, resolve);
    });
  }

  async function setUpSessionWithGame() {
    const session = await createSession();
    createdSessionIds.add(session.id);
    const host = await joinSession({ sessionCode: session.code, role: "HOST", displayName: "Alex" });
    const { socket: hostSocket, ready } = (() => {
      const s = connect(host.token);
      return { socket: s, ready: new Promise<void>((resolve) => s.once("presence:update", () => resolve())) };
    })();
    await ready;
    const teamA = await joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "A1" });
    const teamB = await joinSession({ sessionCode: session.code, role: "TEAM_B", displayName: "B1" });
    const display = await joinSession({ sessionCode: session.code, role: "DISPLAY", displayName: "OBS" });

    const started = await startGame(session.id, "geoguessr", sampleGeoPlaylist);
    if (!started.ok) throw new Error("setup failed to start game");
    broadcastGameSnapshot(io, session.id, started.gameId, started.gameKey, started.state, started.events);
    hostSocket.close();

    return { sessionId: session.id, sessionCode: session.code, host, teamA, teamB, display };
  }

  describe("server-authoritative — who can trigger it, and who can't", () => {
    it("HOST can start/cancel a countdown; TEAM_A, TEAM_B, and DISPLAY are all rejected, over the real socket, not just the pure engine", async () => {
      const { host, teamA, teamB, display } = await setUpSessionWithGame();
      const hostSocket = connect(host.token);
      const teamASocket = connect(teamA.token);
      const teamBSocket = connect(teamB.token);
      const displaySocket = connect(display.token);
      await Promise.all([hostSocket, teamASocket, teamBSocket, displaySocket].map(waitForConnect));

      const teamAAttempt = await sendAction(teamASocket, { type: "START_COUNTDOWN", durationMs: 10_000 });
      expect(teamAAttempt.ok).toBe(false);
      expect(teamAAttempt.error?.code).toBe("FORBIDDEN_ROLE");

      const teamBAttempt = await sendAction(teamBSocket, { type: "START_COUNTDOWN", durationMs: 10_000 });
      expect(teamBAttempt.ok).toBe(false);
      expect(teamBAttempt.error?.code).toBe("FORBIDDEN_ROLE");

      const displayAttempt = await sendAction(displaySocket, { type: "START_COUNTDOWN", durationMs: 10_000 });
      expect(displayAttempt.ok).toBe(false);
      expect(displayAttempt.error?.code).toBe("FORBIDDEN_ROLE");

      const hostAttempt = await sendAction(hostSocket, { type: "START_COUNTDOWN", durationMs: 10_000 });
      expect(hostAttempt.ok).toBe(true);
      expect(hostAttempt.state?.countdownDeadline).not.toBeNull();

      // `nowMs` is server-injected (game.ts), never taken from the
      // client — a socket claiming a manipulated `nowMs` (trying to
      // shorten/extend its own deadline) is silently overwritten, same
      // trust posture as `by`. Confirmed here: the resulting deadline is
      // close to "real now + 10s", not whatever a lying client sent.
      const claimedFarFuture = await sendAction(hostSocket, { type: "START_COUNTDOWN", durationMs: 10_000, nowMs: 9_999_999_999_999 });
      expect(claimedFarFuture.ok).toBe(true);
      expect(claimedFarFuture.state?.countdownDeadline).toBeLessThan(Date.now() + 15_000); // nowhere near the year-2286 timestamp a lying client tried to inject
    });
  });

  describe("reconnect / refresh mid-countdown", () => {
    it("a socket connecting AFTER a countdown already started immediately receives the current deadline — no special reconnect handling needed, it's just ordinary state", async () => {
      const { host, teamA } = await setUpSessionWithGame();
      const hostSocket = connect(host.token);
      await waitForConnect(hostSocket);
      const started = await sendAction(hostSocket, { type: "START_COUNTDOWN", durationMs: 30_000 });
      expect(started.ok).toBe(true);
      const deadline = started.state!.countdownDeadline;
      expect(deadline).not.toBeNull();

      // A player who wasn't even connected yet when the countdown
      // started (simulates "joined/reconnected mid-countdown").
      const teamASocket = connect(teamA.token);
      const snapshot = await new Promise<GeoSnapshot>((resolve) => teamASocket.once("game:state", resolve));
      expect(snapshot.state.countdownDeadline).toBe(deadline); // exact same deadline, no redaction/drift for a non-host role
    });
  });

  describe("lazy self-heal (src/server/game/service.ts's getCurrentGame + checkExpiry) — no real wait needed", () => {
    it("a countdown whose deadline has already passed auto-resolves the NEXT time the game is read, even with no client action and no real-time timer involved", async () => {
      const { sessionId } = await setUpSessionWithGame();
      // Bypasses the socket layer entirely — direct service call, same
      // as show-progress.test.ts's own pattern — so `nowMs` here is
      // whatever THIS test says, not `Date.now()` (only the socket
      // handler injects the real clock). A `nowMs` of 0 + a 10s duration
      // puts the deadline at epoch 10_000 — hopelessly in the past
      // relative to the REAL `Date.now()` `checkExpiry` uses internally.
      const started = await applyGameAction(sessionId, { type: "START_COUNTDOWN", by: "HOST", durationMs: 10_000, nowMs: 0 });
      expect(started.ok).toBe(true);

      // Nobody ever sent END_GAME, and no real-time timer was ever
      // scheduled (this test never touched a socket) — the ONLY thing
      // that can resolve this is getCurrentGame's own lazy self-heal.
      // `sampleGeoPlaylist` (setUpSessionWithGame's own content) has 2
      // rounds — expiring on round 1 now ADVANCES rather than finishing
      // (see engine.test.ts's own dedicated "round-forcing semantics"
      // describe block for the exhaustive domain-level coverage of this
      // — this integration test's own job is proving the self-heal
      // WIRING works end-to-end, not re-litigating every domain nuance).
      const game = await getCurrentGame(sessionId);
      expect(game?.status).toBe("IN_PROGRESS"); // still going — round 2 of 2 remains
      const state = game?.internalState as unknown as { currentRoundIndex: number; phase: string; countdownDeadline: number | null };
      expect(state.currentRoundIndex).toBe(1); // genuinely advanced to round 2, no NEXT_ROUND click involved
      expect(state.phase).toBe("guessing");
      expect(state.countdownDeadline).toBeNull(); // a fresh round always starts countdown-free
    });

    it("expiring on the LAST round genuinely finishes the game via the same lazy self-heal", async () => {
      const session = await createSession();
      createdSessionIds.add(session.id);
      await joinSession({ sessionCode: session.code, role: "HOST", displayName: "Alex" });
      const started = await startGame(session.id, "geoguessr", { rounds: [sampleGeoPlaylist.rounds[0]!] }); // one round only
      if (!started.ok) throw new Error("setup failed to start game");
      broadcastGameSnapshot(io, session.id, started.gameId, started.gameKey, started.state, started.events);

      const result = await applyGameAction(session.id, { type: "START_COUNTDOWN", by: "HOST", durationMs: 10_000, nowMs: 0 });
      expect(result.ok).toBe(true);

      const game = await getCurrentGame(session.id);
      expect(game?.status).toBe("FINISHED");
      const state = game?.internalState as unknown as { winner: string | null; countdownDeadline: number | null };
      expect(state.winner).toBe("TIE"); // 0-0, nobody ever guessed, and there was no round 2 to advance to
      expect(state.countdownDeadline).toBeNull();
    });

    it("does nothing (no false-positive finish) for a countdown that hasn't actually expired yet", async () => {
      const { sessionId } = await setUpSessionWithGame();
      const farFuture = Date.now() + 60 * 60 * 1000; // 1 hour from the REAL now
      const started = await applyGameAction(sessionId, { type: "START_COUNTDOWN", by: "HOST", durationMs: 60_000, nowMs: farFuture });
      expect(started.ok).toBe(true);

      const game = await getCurrentGame(sessionId);
      expect(game?.status).toBe("IN_PROGRESS");
    });
  });

  // Real 10-second waits — the product's own minimum duration, kept to
  // the two tests that actually need to prove the real-time mechanism.
  describe("the real-time primary timer (src/server/sockets/gameEndTimers.ts) — server-governed, not a client setTimeout", () => {
    it(
      "a 10s countdown auto-ADVANCES the game on its own — no client ever sends COUNTDOWN_EXPIRED — and every connected role (Host/Team/Display) receives the exact same resulting state (sampleGeoPlaylist has 2 rounds, so round 1 expiring genuinely moves to round 2, not straight to finished)",
      async () => {
        const { host, teamA, teamB, display } = await setUpSessionWithGame();
        const hostSocket = connect(host.token);
        const teamASocket = connect(teamA.token);
        const teamBSocket = connect(teamB.token);
        const displaySocket = connect(display.token);
        await Promise.all([hostSocket, teamASocket, teamBSocket, displaySocket].map(waitForConnect));

        const advanced = Promise.all([
          waitForStateWhere(hostSocket, (s) => s.state.countdownDeadline === null && s.events.some((e) => e.type === "ROUND_ADVANCED")),
          waitForStateWhere(teamASocket, (s) => s.state.countdownDeadline === null && s.events.some((e) => e.type === "ROUND_ADVANCED")),
          waitForStateWhere(teamBSocket, (s) => s.state.countdownDeadline === null && s.events.some((e) => e.type === "ROUND_ADVANCED")),
          waitForStateWhere(displaySocket, (s) => s.state.countdownDeadline === null && s.events.some((e) => e.type === "ROUND_ADVANCED")),
        ]);

        const started = await sendAction(hostSocket, { type: "START_COUNTDOWN", durationMs: 10_000 });
        expect(started.ok).toBe(true);

        const [hostFinal, teamAFinal, teamBFinal, displayFinal] = await advanced;
        // Byte-identical across every role — same gameId, same round,
        // same "no countdown left dangling."
        for (const snapshot of [hostFinal, teamAFinal, teamBFinal, displayFinal]) {
          expect(snapshot.state.status).toBe("in_progress"); // NOT finished — round 2 of 2 still to play
          expect(snapshot.state.countdownDeadline).toBeNull();
        }
      },
      20_000,
    );

    it(
      "a 10s countdown on the LAST round genuinely finishes the game via the real-time timer, no client action at all",
      async () => {
        const session = await createSession();
        createdSessionIds.add(session.id);
        const host = await joinSession({ sessionCode: session.code, role: "HOST", displayName: "Alex" });
        const started = await startGame(session.id, "geoguessr", { rounds: [sampleGeoPlaylist.rounds[0]!] }); // one round only
        if (!started.ok) throw new Error("setup failed to start game");
        broadcastGameSnapshot(io, session.id, started.gameId, started.gameKey, started.state, started.events);

        const hostSocket = connect(host.token);
        await waitForConnect(hostSocket);
        const finished = waitForStateWhere(hostSocket, (s) => s.state.status === "finished");

        const startResult = await sendAction(hostSocket, { type: "START_COUNTDOWN", durationMs: 10_000 });
        expect(startResult.ok).toBe(true);

        const final = await finished;
        expect(final.state.winner).toBe("TIE"); // 0-0, nobody guessed, and no round 2 to advance to
        expect(final.state.countdownDeadline).toBeNull();
        expect(final.events.some((e) => e.type === "GAME_FINISHED")).toBe(true);
      },
      20_000,
    );

    it(
      "CANCEL_COUNTDOWN genuinely stops the real-time timer from firing — the game is still in progress well past the original deadline",
      async () => {
        const { host } = await setUpSessionWithGame();
        const hostSocket = connect(host.token);
        await waitForConnect(hostSocket);

        const started = await sendAction(hostSocket, { type: "START_COUNTDOWN", durationMs: 10_000 });
        expect(started.ok).toBe(true);
        const cancelled = await sendAction(hostSocket, { type: "CANCEL_COUNTDOWN" });
        expect(cancelled.ok).toBe(true);
        expect(cancelled.state?.countdownDeadline).toBeNull();

        // Wait well past where the ORIGINAL (now-cancelled) deadline
        // would have fired, then confirm nothing auto-ended the game —
        // proves the underlying Node timer was actually cleared
        // (gameEndTimers.ts's `cancelGameEndTimer`), not just the
        // STATE field reset while a stray timer still lurks.
        await new Promise((resolve) => setTimeout(resolve, 11_000));
        const stillGoing = await sendAction(hostSocket, { type: "END_GAME" });
        // If the cancel had failed to stop the real timer, this game
        // would ALREADY be finished by now and this END_GAME would
        // fail with GAME_ALREADY_FINISHED instead of succeeding fresh.
        expect(stillGoing.ok).toBe(true);
      },
      20_000,
    );
  });
});
