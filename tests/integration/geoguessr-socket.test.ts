import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { createSocketServer } from "@/server/sockets";
import { broadcastGameSnapshot } from "@/server/sockets/game";
import { createSession } from "@/server/db/session";
import { joinSession } from "@/server/db/participant";
import { startGame } from "@/server/game";
import { sampleGeoPlaylist } from "@/domain/game/geoGuessr";
import { prisma } from "@/server/db/client";

interface GeoSnapshot {
  gameId: string;
  gameKey: string;
  state: {
    phase: string;
    currentRoundIndex: number;
    scores: { TEAM_A: number; TEAM_B: number };
    guesses: { TEAM_A: { x: number; y: number } | null; TEAM_B: { x: number; y: number } | null };
    lockedTeams: string[];
    roundResult: { targetX: number; targetY: number; roundWinner: string } | null;
    rounds: { targetX: number | null; targetY: number | null }[];
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

  it("TEAM_A's live guess is NEVER sent to TEAM_B or DISPLAY before reveal — only to TEAM_A itself and HOST", async () => {
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

    // HOST sees it (the one role that always sees both teams' guesses).
    expect(hostSnapshot.state.guesses.TEAM_A).toEqual({ x: 0.42, y: 0.73 });
    // TEAM_A sees its OWN guess.
    expect(teamASnapshot.state.guesses.TEAM_A).toEqual({ x: 0.42, y: 0.73 });
    // TEAM_B and DISPLAY never receive it — not redacted-but-present, not
    // sent at all as anything but null.
    expect(teamBSnapshot.state.guesses.TEAM_A).toBeNull();
    expect(displaySnapshot.state.guesses.TEAM_A).toBeNull();

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

  it("full round: both teams guess, A changes its mind, A locks (can't modify after), B locks -> reveal broadcasts target+both guesses+winner to everyone, score updates", async () => {
    const { host, teamA, teamB, display } = await setUpSessionWithGame();
    const hostSocket = connect(host.token);
    const teamASocket = connect(teamA.token);
    const teamBSocket = connect(teamB.token);
    const displaySocket = connect(display.token);
    const displayTrack = trackStates(displaySocket);
    await Promise.all([hostSocket, teamASocket, teamBSocket, displaySocket].map(waitForConnect));

    // Target for round 0 (sampleGeoPlaylist) is (0.5, 0.5).
    await sendAction(teamASocket, { type: "SET_GUESS", x: 0.9, y: 0.9 });
    await sendAction(teamASocket, { type: "SET_GUESS", x: 0.5, y: 0.5 }); // A changes its mind — exactly on target
    await sendAction(teamBSocket, { type: "SET_GUESS", x: 0.0, y: 0.0 }); // far off

    const lockA = await sendAction(teamASocket, { type: "LOCK_GUESS" });
    expect(lockA.ok).toBe(true);

    // A can no longer modify its guess once locked.
    const modifyAfterLock = await sendAction(teamASocket, { type: "SET_GUESS", x: 0.1, y: 0.1 });
    expect(modifyAfterLock.ok).toBe(false);
    expect(modifyAfterLock.error?.code).toBe("TEAM_ALREADY_LOCKED");
    const doubleLock = await sendAction(teamASocket, { type: "LOCK_GUESS" });
    expect(doubleLock.ok).toBe(false);
    expect(doubleLock.error?.code).toBe("TEAM_ALREADY_LOCKED");

    const lockB = await sendAction(teamBSocket, { type: "LOCK_GUESS" });
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

  it("two near-simultaneous locks (A and B firing at once) still produce exactly one reveal with a consistent winner", async () => {
    const { host, teamA, teamB } = await setUpSessionWithGame();
    const hostSocket = connect(host.token);
    const teamASocket = connect(teamA.token);
    const teamBSocket = connect(teamB.token);
    await Promise.all([hostSocket, teamASocket, teamBSocket].map(waitForConnect));

    await sendAction(teamASocket, { type: "SET_GUESS", x: 0.5, y: 0.5 });
    await sendAction(teamBSocket, { type: "SET_GUESS", x: 0.1, y: 0.1 });

    const [lockA, lockB] = await Promise.all([
      sendAction(teamASocket, { type: "LOCK_GUESS" }),
      sendAction(teamBSocket, { type: "LOCK_GUESS" }),
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
    await sendAction(teamASocket, { type: "LOCK_GUESS" });
    await sendAction(teamBSocket, { type: "LOCK_GUESS" });

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

    const displayLock = await sendAction(displaySocket, { type: "LOCK_GUESS" });
    expect(displayLock.ok).toBe(false);
    expect(displayLock.error?.code).toBe("FORBIDDEN_ROLE");

    const hostGuess = await sendAction(hostSocket, { type: "SET_GUESS", x: 0.5, y: 0.5 });
    expect(hostGuess.ok).toBe(false);
    expect(hostGuess.error?.code).toBe("FORBIDDEN_ROLE");

    hostSocket.close();
    displaySocket.close();
  });

  it("reconnecting mid-guess (before lock) recovers the round and the team's own guess, still modifiable", async () => {
    const { host, teamA } = await setUpSessionWithGame();
    const teamASocket = connect(teamA.token);
    await waitForConnect(teamASocket);
    await sendAction(teamASocket, { type: "SET_GUESS", x: 0.33, y: 0.44 });
    teamASocket.close(); // simulate a refresh

    const reconnected = connect(teamA.token);
    const snapshot = await waitForState(reconnected);
    expect(snapshot.state.guesses.TEAM_A).toEqual({ x: 0.33, y: 0.44 });
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
    await sendAction(teamASocket, { type: "LOCK_GUESS" });
    teamASocket.close();

    const reconnected = connect(teamA.token);
    const snapshot = await waitForState(reconnected);
    expect(snapshot.state.lockedTeams).toContain("TEAM_A");

    const ack = await sendAction(reconnected, { type: "SET_GUESS", x: 0.9, y: 0.9 });
    expect(ack.ok).toBe(false);
    expect(ack.error?.code).toBe("TEAM_ALREADY_LOCKED");

    reconnected.close();
  });

  it("rejects a socket connecting with an invalid token", async () => {
    const socket = connect("not-a-real-token");
    const error = await new Promise<Error>((resolve) => socket.on("connect_error", resolve));
    expect(error.message).toBe("INVALID_TOKEN");
    socket.close();
  });
});
