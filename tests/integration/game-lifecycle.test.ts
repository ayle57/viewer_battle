import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { createSocketServer } from "@/server/sockets";
import { broadcastGameSnapshot } from "@/server/sockets/game";
import { createSession, endSession } from "@/server/db/session";
import { joinSession, resolveParticipantByToken } from "@/server/db/participant";
import { getSessionState } from "@/server/db/session";
import { getCurrentGame, startGame } from "@/server/game";
import { sampleBoard } from "@/domain/game/boardQuestion";
import { SessionError } from "@/domain/session";
import { prisma } from "@/server/db/client";

interface BoardSnapshot {
  gameId: string;
  gameKey: string;
  state: {
    status: string;
    phase: string;
    scores: { TEAM_A: number; TEAM_B: number };
    winner: string | null;
    playedQuestionIds: string[];
  };
  events: unknown[];
}

/**
 * Locks the "a Session outlives a Game" cycle this pass introduced (see
 * AGENTS.md "Session vs. Game phases"): a finished BoardQuestion game
 * must leave Session.status ACTIVE, broadcast to every connected role,
 * let the host start a genuinely fresh next game without touching
 * Participants/tokens, and only session.finish (never a game finishing
 * on its own) may end the session for everyone. Same real
 * Socket.IO-server-and-Postgres shape as game-socket.test.ts — this file
 * is specifically the multi-game lifecycle, not kernel rules (already
 * covered by boardQuestion/engine.test.ts) or the bridge in isolation
 * (game-service.test.ts).
 */
describe("Session vs. Game lifecycle (multi-game session)", () => {
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

  function sendAction(socket: ClientSocket, action: Record<string, unknown>) {
    return new Promise<{ ok: boolean; error?: { code: string; message: string }; state?: unknown }>((resolve) => {
      socket.emit("game:action", action, resolve);
    });
  }

  function trackStates(socket: ClientSocket) {
    const received: BoardSnapshot[] = [];
    socket.on("game:state", (snapshot: BoardSnapshot) => received.push(snapshot));
    return {
      received,
      async settle(): Promise<BoardSnapshot> {
        await new Promise((resolve) => setTimeout(resolve, 150));
        const last = received[received.length - 1];
        if (!last) throw new Error("expected at least one game:state event, got none");
        return last;
      },
    };
  }

  /** Host + both teams + display, all genuinely joined and present, no game started yet. */
  async function setUpSessionWithRoster() {
    const session = await createSession();
    createdSessionIds.add(session.id);

    const host = await joinSession({ sessionCode: session.code, role: "HOST", displayName: "Alex" });
    const { ready } = connectAndWaitForPresence(host.token);
    await ready;

    const teamA = await joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "A1" });
    const teamB = await joinSession({ sessionCode: session.code, role: "TEAM_B", displayName: "B1" });
    const display = await joinSession({ sessionCode: session.code, role: "DISPLAY", displayName: "OBS" });

    return { sessionId: session.id, sessionCode: session.code, host, teamA, teamB, display };
  }

  /** Starts board-question and broadcasts it — exactly what the tRPC game.start mutation does (router.ts). */
  async function startAndBroadcast(sessionId: string) {
    const started = await startGame(sessionId, "board-question", sampleBoard);
    if (!started.ok) throw new Error("setup failed to start game");
    broadcastGameSnapshot(io, sessionId, started.gameId, started.gameKey, started.state, started.events);
    return started;
  }

  /** Plays every question on sampleBoard, TEAM_A answering correctly every time, over real sockets — the board finishes once every question has been played (see boardQuestion/engine.ts's finishIfBoardComplete). */
  async function playBoardToFinish(hostSocket: ClientSocket, teamASocket: ClientSocket) {
    for (const question of sampleBoard.questions) {
      await sendAction(hostSocket, { type: "SELECT_QUESTION", questionId: question.id });
      await sendAction(teamASocket, { type: "BUZZ" });
      await sendAction(teamASocket, { type: "SUBMIT_ANSWER", text: "answer" });
      await sendAction(hostSocket, { type: "JUDGE_ANSWER", correct: true });
    }
  }

  it("finishing the game leaves the session ACTIVE — session.finish is the only thing that ends a session", async () => {
    const { sessionId, sessionCode, host, teamA } = await setUpSessionWithRoster();
    await startAndBroadcast(sessionId);
    const hostSocket = connect(host.token);
    const teamASocket = connect(teamA.token);
    await Promise.all([hostSocket, teamASocket].map(waitForConnect));

    await playBoardToFinish(hostSocket, teamASocket);

    const game = await getCurrentGame(sessionId);
    expect(game?.status).toBe("FINISHED");

    const sessionState = await getSessionState(sessionCode);
    expect(sessionState.status).toBe("ACTIVE"); // NOT finished — only session.finish does that

    hostSocket.close();
    teamASocket.close();
  });

  it("every connected role (host, both teams, display) converges on the same GAME_FINISHED broadcast, no refresh needed", async () => {
    const { sessionId, host, teamA, teamB, display } = await setUpSessionWithRoster();
    await startAndBroadcast(sessionId);
    const hostSocket = connect(host.token);
    const teamASocket = connect(teamA.token);
    const teamBSocket = connect(teamB.token);
    const displaySocket = connect(display.token);
    const hostTrack = trackStates(hostSocket);
    const teamBTrack = trackStates(teamBSocket);
    const displayTrack = trackStates(displaySocket);
    await Promise.all([hostSocket, teamASocket, teamBSocket, displaySocket].map(waitForConnect));

    await playBoardToFinish(hostSocket, teamASocket);

    const [hostSnapshot, teamBSnapshot, displaySnapshot] = await Promise.all([
      hostTrack.settle(),
      teamBTrack.settle(),
      displayTrack.settle(),
    ]);
    for (const snapshot of [hostSnapshot, teamBSnapshot, displaySnapshot]) {
      expect(snapshot.state.status).toBe("finished");
      expect(snapshot.state.winner).toBe("TEAM_A");
    }

    hostSocket.close();
    teamASocket.close();
    teamBSocket.close();
    displaySocket.close();
  });

  it("the host can start a fresh next game after the first finishes — new gameId, score reset to 0-0, same participants/tokens untouched", async () => {
    const { sessionId, host, teamA, teamB, display } = await setUpSessionWithRoster();
    const first = await startAndBroadcast(sessionId);
    const hostSocket = connect(host.token);
    const teamASocket = connect(teamA.token);
    const teamBSocket = connect(teamB.token);
    const displaySocket = connect(display.token);
    const teamBTrack = trackStates(teamBSocket);
    const displayTrack = trackStates(displaySocket);
    await Promise.all([hostSocket, teamASocket, teamBSocket, displaySocket].map(waitForConnect));

    await playBoardToFinish(hostSocket, teamASocket);
    await teamBTrack.settle(); // drain the finished broadcast before starting the next game

    const second = await startAndBroadcast(sessionId);
    expect(second.gameId).not.toBe(first.gameId);
    expect((second.state as BoardSnapshot["state"]).status).toBe("in_progress");
    expect((second.state as BoardSnapshot["state"]).scores).toEqual({ TEAM_A: 0, TEAM_B: 0 });
    expect((second.state as BoardSnapshot["state"]).playedQuestionIds).toEqual([]);

    const [teamBSnapshot, displaySnapshot] = await Promise.all([teamBTrack.settle(), displayTrack.settle()]);
    expect(teamBSnapshot.gameId).toBe(second.gameId);
    expect(teamBSnapshot.state.status).toBe("in_progress");
    expect(displaySnapshot.gameId).toBe(second.gameId);

    // Same tokens still resolve to the exact same participants — a new
    // game never re-creates Session/Participant rows.
    await expect(resolveParticipantByToken(host.token)).resolves.toMatchObject({ role: "HOST", sessionId });
    await expect(resolveParticipantByToken(teamA.token)).resolves.toMatchObject({ role: "TEAM_A", sessionId });
    await expect(resolveParticipantByToken(teamB.token)).resolves.toMatchObject({ role: "TEAM_B", sessionId });
    await expect(resolveParticipantByToken(display.token)).resolves.toMatchObject({ role: "DISPLAY", sessionId });

    hostSocket.close();
    teamASocket.close();
    teamBSocket.close();
    displaySocket.close();
  });

  it("matchScore tallies 1 point per game actually won, across multiple games in the same session — independent of each game's own 0-0-per-game score", async () => {
    const { sessionId, sessionCode, host, teamA, teamB } = await setUpSessionWithRoster();
    const hostSocket = connect(host.token);
    const teamASocket = connect(teamA.token);
    const teamBSocket = connect(teamB.token);
    await Promise.all([hostSocket, teamASocket, teamBSocket].map(waitForConnect));

    const beforeAnyGame = await getSessionState(sessionCode);
    expect(beforeAnyGame.matchScore).toEqual({ TEAM_A: 0, TEAM_B: 0 });

    // Game 1: TEAM_A wins every question.
    await startAndBroadcast(sessionId);
    await playBoardToFinish(hostSocket, teamASocket);
    const afterGame1 = await getSessionState(sessionCode);
    expect(afterGame1.matchScore).toEqual({ TEAM_A: 1, TEAM_B: 0 });

    // Game 2: TEAM_B wins every question this time — the match score
    // must credit TEAM_B, and NOT touch game 1's already-recorded point.
    await startAndBroadcast(sessionId);
    for (const question of sampleBoard.questions) {
      await sendAction(hostSocket, { type: "SELECT_QUESTION", questionId: question.id });
      await sendAction(teamBSocket, { type: "BUZZ" });
      await sendAction(teamBSocket, { type: "SUBMIT_ANSWER", text: "answer" });
      await sendAction(hostSocket, { type: "JUDGE_ANSWER", correct: true });
    }
    const afterGame2 = await getSessionState(sessionCode);
    expect(afterGame2.matchScore).toEqual({ TEAM_A: 1, TEAM_B: 1 });

    // The in-game score of the game that just finished is its own,
    // separate 0-0-per-game thing — never conflated with the match tally.
    const currentGame = await getCurrentGame(sessionId);
    expect((currentGame?.internalState as { scores: { TEAM_A: number; TEAM_B: number } }).scores).toEqual({
      TEAM_A: 0,
      TEAM_B: 900,
    });

    hostSocket.close();
    teamASocket.close();
    teamBSocket.close();
  });

  it("a socket reconnecting after the game finished (but before a next one starts) resyncs to the finished snapshot, not stale mid-game data", async () => {
    const { sessionId, host, teamA } = await setUpSessionWithRoster();
    await startAndBroadcast(sessionId);
    const hostSocket = connect(host.token);
    const teamASocket = connect(teamA.token);
    await Promise.all([hostSocket, teamASocket].map(waitForConnect));

    await playBoardToFinish(hostSocket, teamASocket);
    teamASocket.close(); // simulate this tab closing / a refresh right after the game ended

    const reconnected = connect(teamA.token);
    const resync = await new Promise<BoardSnapshot>((resolve) => reconnected.once("game:state", resolve));
    expect(resync.state.status).toBe("finished");
    expect(resync.state.winner).toBe("TEAM_A");

    hostSocket.close();
    reconnected.close();
  });

  it("the host explicitly ending the session marks it FINISHED — nothing else does", async () => {
    const { sessionId, sessionCode, host } = await setUpSessionWithRoster();
    await startAndBroadcast(sessionId);

    const state = await getSessionState(sessionCode);
    expect(state.status).toBe("ACTIVE");

    const participant = await resolveParticipantByToken(host.token);
    await endSession(participant.sessionId);

    // A soft `status: "FINISHED"` update, not a delete — the row (and
    // its history) survives, getSessionState keeps resolving it (see
    // src/server/db/session.ts's endSession).
    const ended = await getSessionState(sessionCode);
    expect(ended.status).toBe("FINISHED");
  });

  it("no new game can be started once the session has been ended — the same guard game.start relies on (resolveParticipantByToken -> SESSION_CLOSED)", async () => {
    const { sessionId, host } = await setUpSessionWithRoster();
    await endSession((await resolveParticipantByToken(host.token)).sessionId);

    // Mirrors exactly what the tRPC game.start procedure does before ever
    // calling startGame: resolve the token first. startGame() itself has
    // no session-status awareness (see src/server/game/service.ts) — this
    // is the real, single place "session ended -> no new game" is
    // actually enforced. The token itself still resolves (the Participant
    // row survives a soft finish) but resolveParticipantByToken refuses
    // it with SESSION_CLOSED once the session's own status is FINISHED.
    await expect(resolveParticipantByToken(host.token)).rejects.toMatchObject({ code: "SESSION_CLOSED" });

    // No game keeps running against an ended session either — startGame
    // never got a chance to run one, so there's nothing left "in
    // progress" to confuse this guarantee with.
    const game = await getCurrentGame(sessionId);
    expect(game).toBeNull();
  });

  it("a socket reconnecting after the session itself has been ended is rejected at auth, not handed stale game/lobby state", async () => {
    const { host } = await setUpSessionWithRoster();
    await endSession((await resolveParticipantByToken(host.token)).sessionId);

    const reconnected = connect(host.token);
    const error = await new Promise<Error & { data?: { code: string } }>((resolve) => reconnected.on("connect_error", resolve));
    expect(error.message).toBe("SESSION_CLOSED");
    expect(error.data?.code).toBe("SESSION_CLOSED");

    reconnected.close();
  });
});

// Sanity-check the shared assumption this whole file leans on: SessionError
// really does carry SESSION_CLOSED the way toMatchObject checks above expect.
describe("sanity", () => {
  it("SessionError('SESSION_CLOSED') matches by code", () => {
    expect(new SessionError("SESSION_CLOSED")).toMatchObject({ code: "SESSION_CLOSED" });
  });
});
