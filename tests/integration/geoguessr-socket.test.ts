import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { createSocketServer } from "@/server/sockets";
import { broadcastGameSnapshot } from "@/server/sockets/game";
import { broadcastParticipantKicked, broadcastSessionCodeRotated } from "@/server/sockets/session";
import { createSession, rotateSessionCode } from "@/server/db/session";
import { joinSession, kickParticipant } from "@/server/db/participant";
import { startGame } from "@/server/game";
import { sampleGeoPlaylist } from "@/domain/game/geoGuessr";
import { prisma } from "@/server/db/client";

interface GeoSnapshot {
  gameId: string;
  gameKey: string;
  state: {
    status: string;
    phase: string;
    currentRoundIndex: number;
    scores: { TEAM_A: number; TEAM_B: number };
    proposals: { TEAM_A: { x: number; y: number }[]; TEAM_B: { x: number; y: number }[] };
    guesses: { TEAM_A: { x: number; y: number } | null; TEAM_B: { x: number; y: number } | null };
    lockedTeams: string[];
    roundResult: { targetX: number; targetY: number; roundWinner: string } | null;
    rounds: { targetX: number | null; targetY: number | null }[];
    winner: string | null;
  };
  events: unknown[];
}

/**
 * Full vertical slice, socket transport, for GeoGuessr specifically — the
 * geo counterpart to game-socket.test.ts, but focused on the ONE thing
 * that engine actually introduces beyond Jeopardy's shape: a genuinely
 * PER-TEAM private live guess, and the room-per-role broadcast
 * (src/server/sockets/game.ts, src/domain/game/rooms.ts) that makes it
 * possible over a real Socket.IO server. game-socket.test.ts (Jeopardy)
 * is untouched — this is a new, parallel file.
 */
describe("GeoGuessr vertical slice (Socket.IO rooms + private guesses + reveal)", () => {
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

  function connectAndWaitForPresence(token: string): { socket: ClientSocket; ready: Promise<void> } {
    const socket = connect(token);
    const ready = new Promise<void>((resolve) => socket.once("presence:update", () => resolve()));
    return { socket, ready };
  }

  async function setUpSessionWithGame() {
    const session = await createSession();
    createdSessionIds.add(session.id);

    const host = await joinSession({ sessionCode: session.code, role: "HOST", displayName: "Alex" });
    const { ready } = connectAndWaitForPresence(host.token);
    await ready;

    const teamA = await joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "A1" });
    const teamB = await joinSession({ sessionCode: session.code, role: "TEAM_B", displayName: "B1" });
    const display = await joinSession({ sessionCode: session.code, role: "DISPLAY", displayName: "OBS" });

    const started = await startGame(session.id, "geoguessr", sampleGeoPlaylist);
    if (!started.ok) throw new Error("setup failed to start game");
    broadcastGameSnapshot(io, session.id, started.gameId, started.gameKey, started.state, started.events);

    return { sessionId: session.id, sessionCode: session.code, host, teamA, teamB, display };
  }

  function waitForState(socket: ClientSocket): Promise<GeoSnapshot> {
    return new Promise((resolve) => socket.once("game:state", resolve));
  }

  /**
   * Like `waitForState`, but skips past broadcasts that don't match yet
   * instead of resolving on the very next one. `registerGameHandlers`
   * (src/server/sockets/game.ts) sends every freshly-connected socket its
   * own initial resync snapshot via an ASYNC db read
   * (`sendCurrentSnapshot`) — that emit can land AFTER this test's own
   * `waitForConnect` already resolved (which only waits for the
   * transport handshake, not for that follow-up db read + emit), so a
   * plain `.once()` registered right after connecting can catch that
   * stale initial snapshot instead of the one a subsequent action
   * actually triggers. Confirmed by reproducing it directly, not a
   * theoretical worry — see the test this was written for.
   */
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

  function trackStates(socket: ClientSocket) {
    const received: GeoSnapshot[] = [];
    socket.on("game:state", (snapshot: GeoSnapshot) => received.push(snapshot));
    return {
      received,
      async settle(): Promise<GeoSnapshot> {
        await new Promise((resolve) => setTimeout(resolve, 150));
        const last = received[received.length - 1];
        if (!last) throw new Error("expected at least one game:state event, got none");
        return last;
      },
    };
  }

  function sendAction(socket: ClientSocket, action: Record<string, unknown>) {
    return new Promise<{ ok: boolean; error?: { code: string; message: string }; state?: unknown }>((resolve) => {
      socket.emit("game:action", action, resolve);
    });
  }

  it("a freshly connecting socket receives the current game snapshot immediately", async () => {
    const { host } = await setUpSessionWithGame();
    const socket = connect(host.token);
    const snapshot = await waitForState(socket);
    expect(snapshot.gameKey).toBe("geoguessr");
    expect(snapshot.state.phase).toBe("guessing");
    socket.close();
  });

  it("TEAM_A's live proposal is NEVER sent to TEAM_B or DISPLAY before reveal — only to TEAM_A itself and HOST", async () => {
    const { host, teamA, teamB, display } = await setUpSessionWithGame();
    const hostSocket = connect(host.token);
    const teamASocket = connect(teamA.token);
    const teamBSocket = connect(teamB.token);
    const displaySocket = connect(display.token);
    const hostTrack = trackStates(hostSocket);
    const teamATrack = trackStates(teamASocket);
    const teamBTrack = trackStates(teamBSocket);
    const displayTrack = trackStates(displaySocket);
    await Promise.all([hostSocket, teamASocket, teamBSocket, displaySocket].map(waitForConnect));

    const ack = await sendAction(teamASocket, { type: "SET_GUESS", x: 0.42, y: 0.73 });
    expect(ack.ok).toBe(true);

    const [hostSnapshot, teamASnapshot, teamBSnapshot, displaySnapshot] = await Promise.all([
      hostTrack.settle(),
      teamATrack.settle(),
      teamBTrack.settle(),
      displayTrack.settle(),
    ]);

    // HOST sees it (the one role that always sees both teams' proposals).
    expect(hostSnapshot.state.proposals.TEAM_A).toEqual([{ x: 0.42, y: 0.73, byName: "A1" }]);
    // TEAM_A sees its OWN proposal.
    expect(teamASnapshot.state.proposals.TEAM_A).toEqual([{ x: 0.42, y: 0.73, byName: "A1" }]);
    // TEAM_B and DISPLAY never receive it — not redacted-but-present, not
    // sent at all as anything but an empty list. (Nobody has LOCKED yet
    // either, so `guesses.TEAM_A` is genuinely null for every role right
    // now, including TEAM_A itself — that's LOCK_GUESS's job, not a
    // redaction case, so it's not what this test is actually proving.)
    expect(teamBSnapshot.state.proposals.TEAM_A).toEqual([]);
    expect(displaySnapshot.state.proposals.TEAM_A).toEqual([]);

    // Same guarantee, the OTHER direction — TEAM_B's own proposal is
    // never sent to TEAM_A either. Same redaction function (view.ts's
    // toPublicView), but this is the one place that symmetry is actually
    // proven over the real transport, not just unit-tested per role.
    const teamBAck = await sendAction(teamBSocket, { type: "SET_GUESS", x: 0.15, y: 0.85 });
    expect(teamBAck.ok).toBe(true);
    const teamASnapshot2 = await teamATrack.settle();
    expect(teamASnapshot2.state.proposals.TEAM_B).toEqual([]);
    const teamBSnapshot2 = await teamBTrack.settle();
    expect(teamBSnapshot2.state.proposals.TEAM_B).toEqual([{ x: 0.15, y: 0.85, byName: "B1" }]);

    hostSocket.close();
    teamASocket.close();
    teamBSocket.close();
    displaySocket.close();
  });

  it("the real target coordinates are never sent to a non-host role before reveal", async () => {
    const { host, teamA, display } = await setUpSessionWithGame();
    // Listeners attached BEFORE connecting (not after awaiting connect) —
    // the server's initial-sync `game:state` (sendCurrentSnapshot) can
    // otherwise arrive before a `.once()` set up post-connect ever
    // attaches, the same race game-socket.test.ts's trackStates helper
    // documents.
    const hostSocket = connect(host.token);
    const hostSnapshotPromise = waitForState(hostSocket);
    const teamASocket = connect(teamA.token);
    const teamASnapshotPromise = waitForState(teamASocket);
    const displaySocket = connect(display.token);
    const displaySnapshotPromise = waitForState(displaySocket);

    const [hostSnapshot, teamASnapshot, displaySnapshot] = await Promise.all([
      hostSnapshotPromise,
      teamASnapshotPromise,
      displaySnapshotPromise,
    ]);
    expect(hostSnapshot.state.rounds[0]!.targetX).toBe(sampleGeoPlaylist.rounds[0]!.targetX);
    expect(teamASnapshot.state.rounds[0]!.targetX).toBeNull();
    expect(displaySnapshot.state.rounds[0]!.targetX).toBeNull();

    hostSocket.close();
    teamASocket.close();
    displaySocket.close();
  });

  it("full round: both teams propose, A locks its SECOND proposal (can't modify/lock again after), B locks -> reveal broadcasts target+both guesses+winner to everyone, score updates", async () => {
    const { host, teamA, teamB, display } = await setUpSessionWithGame();
    const hostSocket = connect(host.token);
    const teamASocket = connect(teamA.token);
    const teamBSocket = connect(teamB.token);
    const displaySocket = connect(display.token);
    const displayTrack = trackStates(displaySocket);
    await Promise.all([hostSocket, teamASocket, teamBSocket, displaySocket].map(waitForConnect));

    // Target for round 0 (sampleGeoPlaylist) is (0.5, 0.5). Both SET_GUESS
    // calls below come from the SAME socket (the same player, "A1") — the
    // second one REPLACES the first in place (one proposal per player,
    // engine.ts's applySetGuess), so this is still just proposal 0
    // throughout, now moved onto the target rather than a real second
    // entry at index 1.
    await sendAction(teamASocket, { type: "SET_GUESS", x: 0.9, y: 0.9 }); // a decoy, index 0
    await sendAction(teamASocket, { type: "SET_GUESS", x: 0.5, y: 0.5 }); // A1 changes their mind — still index 0, now exactly on target
    await sendAction(teamBSocket, { type: "SET_GUESS", x: 0.0, y: 0.0 }); // proposal 0 — far off

    const lockA = await sendAction(teamASocket, { type: "LOCK_GUESS", proposalIndex: 0 });
    expect(lockA.ok).toBe(true);

    // A can no longer propose or lock anything once its team has locked.
    const modifyAfterLock = await sendAction(teamASocket, { type: "SET_GUESS", x: 0.1, y: 0.1 });
    expect(modifyAfterLock.ok).toBe(false);
    expect(modifyAfterLock.error?.code).toBe("TEAM_ALREADY_LOCKED");
    const doubleLock = await sendAction(teamASocket, { type: "LOCK_GUESS", proposalIndex: 0 });
    expect(doubleLock.ok).toBe(false);
    expect(doubleLock.error?.code).toBe("TEAM_ALREADY_LOCKED");

    const lockB = await sendAction(teamBSocket, { type: "LOCK_GUESS", proposalIndex: 0 });
    expect(lockB.ok).toBe(true);

    const displaySnapshot = await displayTrack.settle();
    expect(displaySnapshot.state.phase).toBe("revealed");
    expect(displaySnapshot.state.roundResult).not.toBeNull();
    expect(displaySnapshot.state.roundResult!.targetX).toBe(0.5);
    expect(displaySnapshot.state.roundResult!.roundWinner).toBe("TEAM_A");
    expect(displaySnapshot.state.scores.TEAM_A).toBe(1);
    // Post-reveal, both guesses ARE now visible to Display too.
    expect(displaySnapshot.state.guesses.TEAM_A).toEqual({ x: 0.5, y: 0.5 });
    expect(displaySnapshot.state.guesses.TEAM_B).toEqual({ x: 0.0, y: 0.0 });

    hostSocket.close();
    teamASocket.close();
    teamBSocket.close();
    displaySocket.close();
  });

  it("TWO REAL teammates (separate sockets, both TEAM_A) each see the other's proposal live, and either can lock the other's spot — the whole point of the propose/lock redesign, proven over the real transport, not just within one socket's own two proposals", async () => {
    const session = await createSession();
    createdSessionIds.add(session.id);
    const host = await joinSession({ sessionCode: session.code, role: "HOST", displayName: "Host" });
    const { ready: hostReady } = connectAndWaitForPresence(host.token);
    await hostReady;

    // A real second player on the SAME team — MAX_PLAYERS_PER_TEAM (2)
    // allows exactly this, and it's the actual production shape: two
    // different people, two different browser tabs, two different
    // sockets, same TEAM_A role.
    const a1 = await joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "A1" });
    const a2 = await joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "A2" });
    const teamB = await joinSession({ sessionCode: session.code, role: "TEAM_B", displayName: "B1" });

    const started = await startGame(session.id, "geoguessr", sampleGeoPlaylist);
    if (!started.ok) throw new Error("setup failed");
    broadcastGameSnapshot(io, session.id, started.gameId, started.gameKey, started.state, started.events);

    const a1Socket = connect(a1.token);
    const a2Socket = connect(a2.token);
    const bSocket = connect(teamB.token);
    await Promise.all([a1Socket, a2Socket, bSocket].map(waitForConnect));

    // A1 proposes — A2's OWN socket sees it live, unprompted.
    const a2SeesA1 = waitForStateWhere(a2Socket, (s) => s.state.proposals.TEAM_A.length > 0);
    const a1Propose = await new Promise<{ ok: boolean }>((resolve) => a1Socket.emit("game:action", { type: "SET_GUESS", x: 0.1, y: 0.1 }, resolve));
    expect(a1Propose.ok).toBe(true);
    const a2Snapshot = await a2SeesA1;
    expect(a2Snapshot.state.proposals.TEAM_A).toEqual([{ x: 0.1, y: 0.1, byName: "A1" }]);

    // A2 proposes its OWN spot — A1's socket sees THAT live too (the symmetric direction).
    const a1SeesA2 = waitForStateWhere(a1Socket, (s) => s.state.proposals.TEAM_A.length === 2);
    const a2Propose = await new Promise<{ ok: boolean }>((resolve) => a2Socket.emit("game:action", { type: "SET_GUESS", x: 0.5, y: 0.5 }, resolve));
    expect(a2Propose.ok).toBe(true);
    const a1Snapshot = await a1SeesA2;
    expect(a1Snapshot.state.proposals.TEAM_A).toEqual([
      { x: 0.1, y: 0.1, byName: "A1" },
      { x: 0.5, y: 0.5, byName: "A2" },
    ]);

    // A2 locks A1's proposal (index 0) — not its own (index 1). Real cross-player locking, real sockets.
    const lockA2 = await new Promise<{ ok: boolean; state?: GeoSnapshot["state"] }>((resolve) =>
      a2Socket.emit("game:action", { type: "LOCK_GUESS", proposalIndex: 0 }, resolve),
    );
    expect(lockA2.ok).toBe(true);
    expect(lockA2.state?.guesses.TEAM_A).toEqual({ x: 0.1, y: 0.1 }); // A1's spot, locked in by A2

    // Neither teammate can propose anymore now that the TEAM has locked.
    const a1AfterLock = await new Promise<{ ok: boolean }>((resolve) => a1Socket.emit("game:action", { type: "SET_GUESS", x: 0.9, y: 0.9 }, resolve));
    expect(a1AfterLock.ok).toBe(false);

    a1Socket.close();
    a2Socket.close();
    bSocket.close();
  });

  it("a REAL player re-proposing (same socket, second SET_GUESS) moves their OWN pin in place — never a second pin of their own, and never disturbs their teammate's, over the real transport (real, reported bug: 'je peux avoir deux pings pour un joueur, c'est un ping par joueur')", async () => {
    const session = await createSession();
    createdSessionIds.add(session.id);
    const host = await joinSession({ sessionCode: session.code, role: "HOST", displayName: "Host" });
    const { ready: hostReady } = connectAndWaitForPresence(host.token);
    await hostReady;

    const a1 = await joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "A1" });
    const a2 = await joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "A2" });

    const started = await startGame(session.id, "geoguessr", sampleGeoPlaylist);
    if (!started.ok) throw new Error("setup failed");
    broadcastGameSnapshot(io, session.id, started.gameId, started.gameKey, started.state, started.events);

    const a1Socket = connect(a1.token);
    const a2Socket = connect(a2.token);
    await Promise.all([a1Socket, a2Socket].map(waitForConnect));

    // A1 proposes, A2 proposes — two real, distinct pins, same as the
    // test right above this one.
    const a2SeesA1First = waitForStateWhere(a2Socket, (s) => s.state.proposals.TEAM_A.length > 0);
    await new Promise((resolve) => a1Socket.emit("game:action", { type: "SET_GUESS", x: 0.1, y: 0.1 }, resolve));
    await a2SeesA1First;
    const a1SeesA2 = waitForStateWhere(a1Socket, (s) => s.state.proposals.TEAM_A.length === 2);
    await new Promise((resolve) => a2Socket.emit("game:action", { type: "SET_GUESS", x: 0.5, y: 0.5 }, resolve));
    await a1SeesA2;

    // A1 changes their mind and proposes AGAIN — over the real socket,
    // this must REPLACE A1's own entry, not append a third one, and
    // must never touch A2's own still-open proposal.
    const a2SeesA1Move = waitForStateWhere(a2Socket, (s) => s.state.proposals.TEAM_A.some((p) => p.x === 0.9));
    const a1Repropose = await new Promise<{ ok: boolean; state?: GeoSnapshot["state"] }>((resolve) =>
      a1Socket.emit("game:action", { type: "SET_GUESS", x: 0.9, y: 0.9 }, resolve),
    );
    expect(a1Repropose.ok).toBe(true);
    expect(a1Repropose.state?.proposals.TEAM_A).toEqual([
      { x: 0.9, y: 0.9, byName: "A1" }, // moved in place, still just ONE pin for A1
      { x: 0.5, y: 0.5, byName: "A2" }, // A2's own proposal, completely untouched
    ]);

    const a2Snapshot = await a2SeesA1Move;
    expect(a2Snapshot.state.proposals.TEAM_A).toHaveLength(2); // A2's own live view agrees — never a stray third pin
    expect(a2Snapshot.state.proposals.TEAM_A).toContainEqual({ x: 0.9, y: 0.9, byName: "A1" });
    expect(a2Snapshot.state.proposals.TEAM_A).toContainEqual({ x: 0.5, y: 0.5, byName: "A2" });

    a1Socket.close();
    a2Socket.close();
  });

  it("two near-simultaneous locks (A and B firing at once) still produce exactly one reveal with a consistent winner", async () => {
    const { host, teamA, teamB } = await setUpSessionWithGame();
    const hostSocket = connect(host.token);
    const teamASocket = connect(teamA.token);
    const teamBSocket = connect(teamB.token);
    await Promise.all([hostSocket, teamASocket, teamBSocket].map(waitForConnect));

    await sendAction(teamASocket, { type: "SET_GUESS", x: 0.5, y: 0.5 });
    await sendAction(teamBSocket, { type: "SET_GUESS", x: 0.1, y: 0.1 });

    const [lockA, lockB] = await Promise.all([
      sendAction(teamASocket, { type: "LOCK_GUESS", proposalIndex: 0 }),
      sendAction(teamBSocket, { type: "LOCK_GUESS", proposalIndex: 0 }),
    ]);
    expect(lockA.ok).toBe(true);
    expect(lockB.ok).toBe(true);

    const hostSnapshot = await waitForState(connect(host.token));
    expect(hostSnapshot.state.phase).toBe("revealed");
    expect(hostSnapshot.state.roundResult!.roundWinner).toBe("TEAM_A");
    // Optimistic-concurrency retry (SessionGame.version, see
    // src/server/game/service.ts) means BOTH locks land, applied
    // sequentially — never a lost update, never two separate reveals.
    expect(hostSnapshot.state.lockedTeams.sort()).toEqual(["TEAM_A", "TEAM_B"]);

    hostSocket.close();
    teamASocket.close();
    teamBSocket.close();
  });

  it("HOST advances rounds after reveal; TEAM_B cannot", async () => {
    const { host, teamA, teamB } = await setUpSessionWithGame();
    const hostSocket = connect(host.token);
    const teamASocket = connect(teamA.token);
    const teamBSocket = connect(teamB.token);
    await Promise.all([hostSocket, teamASocket, teamBSocket].map(waitForConnect));

    await sendAction(teamASocket, { type: "SET_GUESS", x: 0.5, y: 0.5 });
    await sendAction(teamBSocket, { type: "SET_GUESS", x: 0.1, y: 0.1 });
    await sendAction(teamASocket, { type: "LOCK_GUESS", proposalIndex: 0 });
    await sendAction(teamBSocket, { type: "LOCK_GUESS", proposalIndex: 0 });

    const wrongRole = await sendAction(teamBSocket, { type: "NEXT_ROUND" });
    expect(wrongRole.ok).toBe(false);
    expect(wrongRole.error?.code).toBe("FORBIDDEN_ROLE");

    const next = await sendAction(hostSocket, { type: "NEXT_ROUND" });
    expect(next.ok).toBe(true);

    const teamASnapshot = await waitForState(connect(teamA.token));
    expect(teamASnapshot.state.currentRoundIndex).toBe(1);
    expect(teamASnapshot.state.phase).toBe("guessing");
    expect(teamASnapshot.state.guesses.TEAM_A).toBeNull(); // fresh round, no stale guess

    hostSocket.close();
    teamASocket.close();
    teamBSocket.close();
  });

  it("wrong role attempts are rejected: DISPLAY can never SET_GUESS/LOCK_GUESS, HOST cannot guess", async () => {
    const { host, display } = await setUpSessionWithGame();
    const hostSocket = connect(host.token);
    const displaySocket = connect(display.token);
    await Promise.all([hostSocket, displaySocket].map(waitForConnect));

    const displayGuess = await sendAction(displaySocket, { type: "SET_GUESS", x: 0.5, y: 0.5 });
    expect(displayGuess.ok).toBe(false);
    expect(displayGuess.error?.code).toBe("FORBIDDEN_ROLE");

    const displayLock = await sendAction(displaySocket, { type: "LOCK_GUESS", proposalIndex: 0 });
    expect(displayLock.ok).toBe(false);
    expect(displayLock.error?.code).toBe("FORBIDDEN_ROLE");

    const hostGuess = await sendAction(hostSocket, { type: "SET_GUESS", x: 0.5, y: 0.5 });
    expect(hostGuess.ok).toBe(false);
    expect(hostGuess.error?.code).toBe("FORBIDDEN_ROLE");

    hostSocket.close();
    displaySocket.close();
  });

  it("reconnecting mid-guess (before lock) recovers the round and the team's own proposal, still addable/lockable", async () => {
    const { host, teamA } = await setUpSessionWithGame();
    const teamASocket = connect(teamA.token);
    await waitForConnect(teamASocket);
    await sendAction(teamASocket, { type: "SET_GUESS", x: 0.33, y: 0.44 });
    teamASocket.close(); // simulate a refresh

    const reconnected = connect(teamA.token);
    const snapshot = await waitForState(reconnected);
    expect(snapshot.state.proposals.TEAM_A).toEqual([{ x: 0.33, y: 0.44, byName: "A1" }]);
    expect(snapshot.state.lockedTeams).toEqual([]);

    // Still fully modifiable and lockable after reconnect.
    const ack = await sendAction(reconnected, { type: "SET_GUESS", x: 0.1, y: 0.1 });
    expect(ack.ok).toBe(true);

    void host; // host identity only needed for setup here
    reconnected.close();
  });

  it("reconnecting AFTER lock never allows modifying the guess again", async () => {
    const { teamA } = await setUpSessionWithGame();
    const teamASocket = connect(teamA.token);
    await waitForConnect(teamASocket);
    await sendAction(teamASocket, { type: "SET_GUESS", x: 0.5, y: 0.5 });
    await sendAction(teamASocket, { type: "LOCK_GUESS", proposalIndex: 0 });
    teamASocket.close();

    const reconnected = connect(teamA.token);
    const snapshot = await waitForState(reconnected);
    expect(snapshot.state.lockedTeams).toContain("TEAM_A");

    const ack = await sendAction(reconnected, { type: "SET_GUESS", x: 0.9, y: 0.9 });
    expect(ack.ok).toBe(false);
    expect(ack.error?.code).toBe("TEAM_ALREADY_LOCKED");

    reconnected.close();
  });

  it("kicking a participant mid-round (session.kick's real path: delete + rotate code + notify) leaves GeoGuessr running normally for everyone still connected", async () => {
    const { sessionId, host, teamA, teamB, display } = await setUpSessionWithGame();
    const hostSocket = connect(host.token);
    const teamASocket = connect(teamA.token);
    const teamBSocket = connect(teamB.token);
    const displaySocket = connect(display.token);
    await Promise.all([hostSocket, teamASocket, teamBSocket, displaySocket].map(waitForConnect));

    const kicked = new Promise<void>((resolve) => displaySocket.once("participant:kicked", () => resolve()));
    const disconnected = new Promise<void>((resolve) => displaySocket.once("disconnect", () => resolve()));
    // A REAL, REPRODUCED bug this locks down: rotating the session code
    // (here, as a side-effect of kicking someone) only ever changed the
    // DB column — every OTHER still-connected client's own
    // `session.getState` polling kept using the STALE code it joined
    // with, which started 404ing forever, misread client-side as the
    // whole session having ended (see broadcastSessionCodeRotated's own
    // doc comment). Both teams — genuinely innocent bystanders, neither
    // one was kicked — must hear the fresh code in real time.
    const teamAHeardNewCode = new Promise<string>((resolve) => teamASocket.once("session:code-rotated", ({ code }: { code: string }) => resolve(code)));
    const teamBHeardNewCode = new Promise<string>((resolve) => teamBSocket.once("session:code-rotated", ({ code }: { code: string }) => resolve(code)));

    // Exactly what session.kick (router.ts) does, in the same order.
    await kickParticipant(sessionId, display.id);
    const newCode = await rotateSessionCode(sessionId);
    broadcastParticipantKicked(io, display.id);
    broadcastSessionCodeRotated(io, sessionId, newCode);
    const [, , teamAGotCode, teamBGotCode] = await Promise.all([kicked, disconnected, teamAHeardNewCode, teamBHeardNewCode]);
    expect(teamAGotCode).toBe(newCode);
    expect(teamBGotCode).toBe(newCode);

    // GeoGuessr has no concept of a DISPLAY participant in its own state
    // (only TEAM_A/TEAM_B) — the round in progress is completely
    // unaffected for the Host and both teams still connected.
    await sendAction(teamASocket, { type: "SET_GUESS", x: 0.5, y: 0.5 });
    await sendAction(teamBSocket, { type: "SET_GUESS", x: 0.1, y: 0.1 });
    await sendAction(teamASocket, { type: "LOCK_GUESS", proposalIndex: 0 });
    const reveal = await sendAction(teamBSocket, { type: "LOCK_GUESS", proposalIndex: 0 });
    expect(reveal.ok).toBe(true);

    const hostSnapshot = await waitForState(connect(host.token));
    expect(hostSnapshot.state.phase).toBe("revealed");
    expect(hostSnapshot.state.roundResult!.roundWinner).toBe("TEAM_A");

    hostSocket.close();
    teamASocket.close();
    teamBSocket.close();
  });

  it("the last configured round finishes the game for real — GAME_FINISHED broadcasts to every role, not just the host who triggered it", async () => {
    const { host, teamA, teamB, display } = await setUpSessionWithGame();
    const hostSocket = connect(host.token);
    const teamASocket = connect(teamA.token);
    const teamBSocket = connect(teamB.token);
    const displaySocket = connect(display.token);
    const displayTrack = trackStates(displaySocket);
    await Promise.all([hostSocket, teamASocket, teamBSocket, displaySocket].map(waitForConnect));

    // Round 1/2 (target 0.5,0.5): TEAM_A wins.
    await sendAction(teamASocket, { type: "SET_GUESS", x: 0.5, y: 0.5 });
    await sendAction(teamBSocket, { type: "SET_GUESS", x: 0.0, y: 0.0 });
    await sendAction(teamASocket, { type: "LOCK_GUESS", proposalIndex: 0 });
    await sendAction(teamBSocket, { type: "LOCK_GUESS", proposalIndex: 0 });
    await sendAction(hostSocket, { type: "NEXT_ROUND" });

    // Round 2/2 (target 0.25,0.75) — sampleGeoPlaylist's LAST round, so
    // this reveal also finishes the game outright (engine.ts's
    // applyLockGuess: `noMoreRounds`), with no separate host action.
    await sendAction(teamASocket, { type: "SET_GUESS", x: 0.0, y: 0.0 });
    await sendAction(teamBSocket, { type: "SET_GUESS", x: 0.25, y: 0.75 });
    await sendAction(teamASocket, { type: "LOCK_GUESS", proposalIndex: 0 });
    const finalLock = await sendAction(teamBSocket, { type: "LOCK_GUESS", proposalIndex: 0 });
    expect(finalLock.ok).toBe(true);

    const finalSnapshot = await displayTrack.settle();
    expect(finalSnapshot.state.status).toBe("finished");
    expect(finalSnapshot.state.phase).toBe("revealed");
    expect(finalSnapshot.state.scores).toEqual({ TEAM_A: 1, TEAM_B: 1 });
    expect(finalSnapshot.state.winner).toBe("TIE");

    hostSocket.close();
    teamASocket.close();
    teamBSocket.close();
    displaySocket.close();
  });

  it("Play Again: the host starts a fresh GeoGuessr game after the first finishes — new gameId, score reset to 0-0, broadcast to every connected role", async () => {
    const { sessionId, host, teamA, teamB, display } = await setUpSessionWithGame();
    const hostSocket = connect(host.token);
    const teamASocket = connect(teamA.token);
    const teamBSocket = connect(teamB.token);
    const displaySocket = connect(display.token);
    const displayTrack = trackStates(displaySocket);
    await Promise.all([hostSocket, teamASocket, teamBSocket, displaySocket].map(waitForConnect));

    const firstGameId = (await waitForState(connect(host.token))).gameId;
    const ended = await sendAction(hostSocket, { type: "END_GAME" }); // a real host action, not a fake local reset
    expect(ended.ok).toBe(true);
    await displayTrack.settle(); // drain the finished broadcast before starting the next game

    const second = await startGame(sessionId, "geoguessr", sampleGeoPlaylist);
    if (!second.ok) throw new Error("Play Again setup failed to start the second game");
    expect(second.gameId).not.toBe(firstGameId);
    broadcastGameSnapshot(io, sessionId, second.gameId, second.gameKey, second.state, second.events);

    const [teamBSnapshot, displaySnapshot] = await Promise.all([waitForState(teamBSocket), displayTrack.settle()]);
    expect(teamBSnapshot.gameId).toBe(second.gameId);
    expect(teamBSnapshot.state.status).toBe("in_progress");
    expect(teamBSnapshot.state.scores).toEqual({ TEAM_A: 0, TEAM_B: 0 }); // NOT carried over from the finished game
    expect(displaySnapshot.gameId).toBe(second.gameId);

    hostSocket.close();
    teamASocket.close();
    teamBSocket.close();
    displaySocket.close();
  });

  it("HOST reconnecting mid-round (after a team already locked) resyncs to the exact live state, not a stale or generic snapshot", async () => {
    const { host, teamA } = await setUpSessionWithGame();
    const hostSocket = connect(host.token);
    const teamASocket = connect(teamA.token);
    await Promise.all([hostSocket, teamASocket].map(waitForConnect));

    await sendAction(teamASocket, { type: "SET_GUESS", x: 0.6, y: 0.6 });
    await sendAction(teamASocket, { type: "LOCK_GUESS", proposalIndex: 0 });
    hostSocket.close(); // simulate the Host's own tab refreshing mid-round

    const reconnectedHost = connect(host.token);
    const snapshot = await waitForState(reconnectedHost);
    expect(snapshot.state.lockedTeams).toEqual(["TEAM_A"]);
    // The one role that keeps seeing the raw guess even mid-reconnect —
    // proves this is a genuine HOST-scoped resync, not e.g. the public
    // room's redacted snapshot handed to the host by mistake.
    expect(snapshot.state.guesses.TEAM_A).toEqual({ x: 0.6, y: 0.6 });

    reconnectedHost.close();
    teamASocket.close();
  });

  it("DISPLAY reconnecting mid-reveal resyncs to the real revealed state — target and both guesses, not the pre-reveal redacted view", async () => {
    const { teamA, teamB, display } = await setUpSessionWithGame();
    const teamASocket = connect(teamA.token);
    const teamBSocket = connect(teamB.token);
    const displaySocket = connect(display.token);
    await Promise.all([teamASocket, teamBSocket, displaySocket].map(waitForConnect));

    await sendAction(teamASocket, { type: "SET_GUESS", x: 0.5, y: 0.5 });
    await sendAction(teamBSocket, { type: "SET_GUESS", x: 0.9, y: 0.9 });
    await sendAction(teamASocket, { type: "LOCK_GUESS", proposalIndex: 0 });
    await sendAction(teamBSocket, { type: "LOCK_GUESS", proposalIndex: 0 }); // second lock -> reveal
    displaySocket.close(); // simulate OBS's browser source reloading right after reveal

    const reconnectedDisplay = connect(display.token);
    const snapshot = await waitForState(reconnectedDisplay);
    expect(snapshot.state.phase).toBe("revealed");
    expect(snapshot.state.roundResult).not.toBeNull();
    expect(snapshot.state.guesses.TEAM_A).toEqual({ x: 0.5, y: 0.5 });
    expect(snapshot.state.guesses.TEAM_B).toEqual({ x: 0.9, y: 0.9 });

    reconnectedDisplay.close();
    teamASocket.close();
    teamBSocket.close();
  });

  it("rejects a socket connecting with an invalid token", async () => {
    const socket = connect("not-a-real-token");
    const error = await new Promise<Error>((resolve) => socket.on("connect_error", resolve));
    expect(error.message).toBe("INVALID_TOKEN");
    socket.close();
  });
});
