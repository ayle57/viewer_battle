import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { createSocketServer } from "@/server/sockets";
import { broadcastGameSnapshot } from "@/server/sockets/game";
import { createSession } from "@/server/db/session";
import { joinSession } from "@/server/db/participant";
import { startGame } from "@/server/game";
import { sampleBoard } from "@/domain/game/boardQuestion";
import { prisma } from "@/server/db/client";

interface BoardSnapshot {
  gameId: string;
  gameKey: string;
  state: {
    phase: string;
    scores: { TEAM_A: number; TEAM_B: number };
    activeQuestionId: string | null;
    buzzedTeam: string | null;
    submittedAnswer: string | null;
    questions: { id: string; prompt: string; answer: string }[];
  };
  events: unknown[];
}

/**
 * Full vertical slice, socket transport: real Socket.IO server (same
 * createSocketServer as src/server/server.ts), real Postgres, real
 * clients per role. Kernel rule coverage already lives in
 * boardQuestion/engine.test.ts and the bridge's own logic in
 * game-service.test.ts — this file is specifically "does the realtime
 * wiring — rooms, redaction, reconnection, permissions — actually work."
 */
describe("Game vertical slice (Socket.IO rooms + redaction + reconnection)", () => {
  let baseUrl: string;
  let httpServer: ReturnType<typeof createServer>;
  let io: ReturnType<typeof createSocketServer>;
  const createdSessionIds = new Set<string>();

  beforeAll(async () => {
    httpServer = createServer();
    io = createSocketServer(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const { port } = httpServer.address() as AddressInfo;
    baseUrl = `http://localhost:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await prisma.session.deleteMany({ where: { id: { in: Array.from(createdSessionIds) } } });
    await prisma.$disconnect();
  });

  /** Sets up a session with all 4 roles joined and a game already started+broadcast, mirroring what tRPC's game.start does. */
  async function setUpSessionWithGame() {
    const session = await createSession();
    createdSessionIds.add(session.id);

    const host = await joinSession({ sessionCode: session.code, role: "HOST", displayName: "Alex" });
    const teamA = await joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "A1" });
    const teamB = await joinSession({ sessionCode: session.code, role: "TEAM_B", displayName: "B1" });
    const display = await joinSession({ sessionCode: session.code, role: "DISPLAY", displayName: "OBS" });

    const started = await startGame(session.id, "board-question", sampleBoard);
    if (!started.ok) throw new Error("setup failed to start game");
    broadcastGameSnapshot(io, session.id, started.gameId, started.gameKey, started.state, started.events);

    return { sessionId: session.id, sessionCode: session.code, host, teamA, teamB, display };
  }

  function connect(token: string): ClientSocket {
    return ioClient(baseUrl, { path: "/socket.io", auth: { token }, transports: ["websocket"], forceNew: true });
  }

  function waitForConnect(socket: ClientSocket) {
    return new Promise<void>((resolve) => socket.on("connect", () => resolve()));
  }

  function waitForState(socket: ClientSocket): Promise<BoardSnapshot> {
    return new Promise((resolve) => socket.once("game:state", resolve));
  }

  /**
   * Collects every `game:state` this socket receives from here on, rather
   * than waiting for exactly one — a bare `.once()` set up right after
   * connecting can race the server's own initial-sync emit and catch that
   * instead of the broadcast an action triggers next. `settle()` gives
   * in-flight broadcasts a moment to land (same margin chat-socket.test.ts
   * uses) and returns the most recent snapshot.
   */
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

  function sendAction(socket: ClientSocket, action: Record<string, unknown>) {
    return new Promise<{ ok: boolean; error?: { code: string; message: string }; state?: unknown }>((resolve) => {
      socket.emit("game:action", action, resolve);
    });
  }

  it("a freshly connecting socket receives the current game snapshot immediately (initial sync)", async () => {
    const { host } = await setUpSessionWithGame();
    const socket = connect(host.token);
    const snapshot = await waitForState(socket);
    expect(snapshot.gameKey).toBe("board-question");
    expect(snapshot.state.phase).toBe("selecting");
    socket.close();
  });

  it("HOST sees the answer key; TEAM_A/TEAM_B/DISPLAY never do, even for the active question", async () => {
    const { host, teamA, display } = await setUpSessionWithGame();
    const hostSocket = connect(host.token);
    const teamASocket = connect(teamA.token);
    const displaySocket = connect(display.token);
    const hostTrack = trackStates(hostSocket);
    const teamATrack = trackStates(teamASocket);
    const displayTrack = trackStates(displaySocket);
    await Promise.all([hostSocket, teamASocket, displaySocket].map(waitForConnect));

    const ack = await sendAction(hostSocket, { type: "SELECT_QUESTION", questionId: "q-geo-100" });
    expect(ack.ok).toBe(true);

    const [hostSnapshot, teamASnapshot, displaySnapshot] = await Promise.all([
      hostTrack.settle(),
      teamATrack.settle(),
      displayTrack.settle(),
    ]);

    const hostQuestion = hostSnapshot.state.questions.find((q) => q.id === "q-geo-100")!;
    expect(hostQuestion.prompt).not.toBe("");
    expect(hostQuestion.answer).not.toBe("");

    for (const snapshot of [teamASnapshot, displaySnapshot]) {
      const question = snapshot.state.questions.find((q) => q.id === "q-geo-100")!;
      expect(question.prompt).not.toBe(""); // active question IS visible
      expect(question.answer).toBe(""); // but never the answer
      const unrevealed = snapshot.state.questions.find((q) => q.id === "q-geo-200")!;
      expect(unrevealed.prompt).toBe(""); // not-yet-selected question stays hidden
    }

    hostSocket.close();
    teamASocket.close();
    displaySocket.close();
  });

  it("full play: select -> buzz -> judge correct -> score broadcast to everyone", async () => {
    const { host, teamA, teamB, display } = await setUpSessionWithGame();
    const hostSocket = connect(host.token);
    const teamASocket = connect(teamA.token);
    const teamBSocket = connect(teamB.token);
    const displaySocket = connect(display.token);
    const teamBTrack = trackStates(teamBSocket);
    const displayTrack = trackStates(displaySocket);
    await Promise.all([hostSocket, teamASocket, teamBSocket, displaySocket].map(waitForConnect));

    await sendAction(hostSocket, { type: "SELECT_QUESTION", questionId: "q-geo-100" });

    const buzzAck = await sendAction(teamASocket, { type: "BUZZ" });
    expect(buzzAck.ok).toBe(true);
    expect((await teamBTrack.settle()).state.buzzedTeam).toBe("TEAM_A");

    const submitAck = await sendAction(teamASocket, { type: "SUBMIT_ANSWER", text: "Tokyo" });
    expect(submitAck.ok).toBe(true);
    expect((await teamBTrack.settle()).state.submittedAnswer).toBe("Tokyo");

    const judgeAck = await sendAction(hostSocket, { type: "JUDGE_ANSWER", correct: true });
    expect(judgeAck.ok).toBe(true);
    const displaySnapshot = await displayTrack.settle();
    expect(displaySnapshot.state.scores.TEAM_A).toBe(100);

    hostSocket.close();
    teamASocket.close();
    teamBSocket.close();
    displaySocket.close();
  });

  it("TEAM_B cannot buzz once TEAM_A already has (not their turn)", async () => {
    const { host, teamA, teamB } = await setUpSessionWithGame();
    const hostSocket = connect(host.token);
    const teamASocket = connect(teamA.token);
    const teamBSocket = connect(teamB.token);
    await Promise.all([hostSocket, teamASocket, teamBSocket].map(waitForConnect));

    await sendAction(hostSocket, { type: "SELECT_QUESTION", questionId: "q-geo-100" });
    await sendAction(teamASocket, { type: "BUZZ" });

    const ack = await sendAction(teamBSocket, { type: "BUZZ" });
    expect(ack.ok).toBe(false);
    expect(ack.error?.code).toBe("WRONG_PHASE");

    hostSocket.close();
    teamASocket.close();
    teamBSocket.close();
  });

  it("TEAM_B cannot judge an answer (host-only action)", async () => {
    const { host, teamA, teamB } = await setUpSessionWithGame();
    const hostSocket = connect(host.token);
    const teamASocket = connect(teamA.token);
    const teamBSocket = connect(teamB.token);
    await Promise.all([hostSocket, teamASocket, teamBSocket].map(waitForConnect));

    await sendAction(hostSocket, { type: "SELECT_QUESTION", questionId: "q-geo-100" });
    await sendAction(teamASocket, { type: "BUZZ" });

    const ack = await sendAction(teamBSocket, { type: "JUDGE_ANSWER", correct: true });
    expect(ack.ok).toBe(false);
    expect(ack.error?.code).toBe("FORBIDDEN_ROLE");

    hostSocket.close();
    teamASocket.close();
    teamBSocket.close();
  });

  it("only the team that buzzed may submit an answer, and it's visible to every role once sent", async () => {
    const { host, teamA, teamB, display } = await setUpSessionWithGame();
    const hostSocket = connect(host.token);
    const teamASocket = connect(teamA.token);
    const teamBSocket = connect(teamB.token);
    const displaySocket = connect(display.token);
    const hostTrack = trackStates(hostSocket);
    const teamBTrack = trackStates(teamBSocket);
    const displayTrack = trackStates(displaySocket);
    await Promise.all([hostSocket, teamASocket, teamBSocket, displaySocket].map(waitForConnect));

    await sendAction(hostSocket, { type: "SELECT_QUESTION", questionId: "q-geo-100" });
    await sendAction(teamASocket, { type: "BUZZ" });

    const wrongTeamAck = await sendAction(teamBSocket, { type: "SUBMIT_ANSWER", text: "Kyoto" });
    expect(wrongTeamAck.ok).toBe(false);
    expect(wrongTeamAck.error?.code).toBe("FORBIDDEN_ROLE");

    const judgeTooEarly = await sendAction(hostSocket, { type: "JUDGE_ANSWER", correct: true });
    expect(judgeTooEarly.ok).toBe(false);
    expect(judgeTooEarly.error?.code).toBe("ANSWER_NOT_SUBMITTED");

    const submitAck = await sendAction(teamASocket, { type: "SUBMIT_ANSWER", text: "Tokyo" });
    expect(submitAck.ok).toBe(true);

    const [hostSnapshot, teamBSnapshot, displaySnapshot] = await Promise.all([
      hostTrack.settle(),
      teamBTrack.settle(),
      displayTrack.settle(),
    ]);
    // Visible everywhere — this stands in for speaking the answer aloud on
    // a live broadcast, not a secret; only the reference `answer` key stays
    // host-only (see boardQuestion/types.ts).
    expect(hostSnapshot.state.submittedAnswer).toBe("Tokyo");
    expect(teamBSnapshot.state.submittedAnswer).toBe("Tokyo");
    expect(displaySnapshot.state.submittedAnswer).toBe("Tokyo");

    hostSocket.close();
    teamASocket.close();
    teamBSocket.close();
    displaySocket.close();
  });

  it("DISPLAY can never submit any game action", async () => {
    const { host, display } = await setUpSessionWithGame();
    const hostSocket = connect(host.token);
    const displaySocket = connect(display.token);
    await Promise.all([hostSocket, displaySocket].map(waitForConnect));

    await sendAction(hostSocket, { type: "SELECT_QUESTION", questionId: "q-geo-100" });

    const buzzAck = await sendAction(displaySocket, { type: "BUZZ" });
    expect(buzzAck.ok).toBe(false);
    expect(buzzAck.error?.code).toBe("FORBIDDEN_ROLE");

    const selectAck = await sendAction(displaySocket, { type: "SELECT_QUESTION", questionId: "q-geo-200" });
    expect(selectAck.ok).toBe(false);
    expect(selectAck.error?.code).toBe("FORBIDDEN_ROLE");

    const submitAck = await sendAction(displaySocket, { type: "SUBMIT_ANSWER", text: "anything" });
    expect(submitAck.ok).toBe(false);
    expect(submitAck.error?.code).toBe("FORBIDDEN_ROLE");

    hostSocket.close();
    displaySocket.close();
  });

  it("reconnecting (fresh socket, same token) gets the current persisted state, not stale data", async () => {
    const { host, teamA } = await setUpSessionWithGame();
    const hostSocket = connect(host.token);
    await waitForConnect(hostSocket);
    await sendAction(hostSocket, { type: "SELECT_QUESTION", questionId: "q-geo-100" });
    hostSocket.close(); // simulate the host's tab closing / a refresh

    const teamASocket = connect(teamA.token);
    const snapshotOnConnect = await waitForState(teamASocket);
    expect(snapshotOnConnect.state.phase).toBe("revealed");
    expect(snapshotOnConnect.state.activeQuestionId).toBe("q-geo-100");
    teamASocket.close();

    // Now the host reconnects (a real refresh) and should see the same thing.
    const hostReconnected = connect(host.token);
    const hostResync = await waitForState(hostReconnected);
    expect(hostResync.state.phase).toBe("revealed");
    hostReconnected.close();
  });

  it("a player who buzzed, submitted, and drops mid-judgment reconnects to the exact same moment — no reset", async () => {
    const { host, teamA } = await setUpSessionWithGame();
    const hostSocket = connect(host.token);
    const teamASocket = connect(teamA.token);
    await Promise.all([hostSocket, teamASocket].map(waitForConnect));

    await sendAction(hostSocket, { type: "SELECT_QUESTION", questionId: "q-geo-100" });
    await sendAction(teamASocket, { type: "BUZZ" });
    await sendAction(teamASocket, { type: "SUBMIT_ANSWER", text: "Tokyo" });

    // Simulates the exact scenario this stabilization pass was about: the
    // player's socket drops (network blip, tab reload, whatever) while the
    // host still hasn't judged. The server is source of truth — nothing
    // about the game moved on just because this one client dropped.
    teamASocket.close();

    const teamAReconnected = connect(teamA.token);
    const resync = await waitForState(teamAReconnected);
    expect(resync.gameId).toBeTruthy();
    expect(resync.state.phase).toBe("answering");
    expect(resync.state.buzzedTeam).toBe("TEAM_A");
    expect(resync.state.submittedAnswer).toBe("Tokyo");

    // The game is still fully playable from here — judging still works
    // against the reconnected client's session.
    const judgeAck = await sendAction(hostSocket, { type: "JUDGE_ANSWER", correct: true });
    expect(judgeAck.ok).toBe(true);

    hostSocket.close();
    teamAReconnected.close();
  });

  it("two independently connected clients observe the identical broadcast state after an action", async () => {
    const { host, teamB, display } = await setUpSessionWithGame();
    const hostSocket = connect(host.token);
    const teamBSocket = connect(teamB.token);
    const displaySocket = connect(display.token);
    const teamBTrack = trackStates(teamBSocket);
    const displayTrack = trackStates(displaySocket);
    await Promise.all([hostSocket, teamBSocket, displaySocket].map(waitForConnect));

    await sendAction(hostSocket, { type: "SELECT_QUESTION", questionId: "q-sci-100" });

    const [teamBState, displayState] = await Promise.all([teamBTrack.settle(), displayTrack.settle()]);
    expect(teamBState.state.activeQuestionId).toBe(displayState.state.activeQuestionId);
    expect(teamBState.state.phase).toBe(displayState.state.phase);

    hostSocket.close();
    teamBSocket.close();
    displaySocket.close();
  });

  it("a socket that was already connected before an action keeps its gameId across the broadcast (TEAM_A repro)", async () => {
    // Reproduces exactly what was reported against the Quick Demo: Host
    // and Team A open first and Team A's tab is already showing the
    // board, then the host acts before Team B/Display ever connect. Team
    // A's *own* connection-time snapshot always carried gameId — the bug
    // was broadcastGameSnapshot's payload (what an ALREADY-connected
    // socket receives on a subsequent action) omitting it, which made an
    // already-fine client regress to "no game running" the moment
    // anything happened, while sockets connecting fresh afterwards (Team
    // B, Display) looked fine because their own initial snapshot always
    // had it. See src/server/sockets/game.ts.
    const { host, teamA, teamB, display } = await setUpSessionWithGame();
    const hostSocket = connect(host.token);
    const teamASocket = connect(teamA.token);
    const teamATrack = trackStates(teamASocket);
    await Promise.all([hostSocket, teamASocket].map(waitForConnect));

    const initialSnapshot = await teamATrack.settle();
    expect(initialSnapshot.gameId).toBeTruthy();

    const ack = await sendAction(hostSocket, { type: "SELECT_QUESTION", questionId: "q-geo-100" });
    expect(ack.ok).toBe(true);

    const snapshotAfterAction = await teamATrack.settle();
    expect(snapshotAfterAction.gameId).toBe(initialSnapshot.gameId);

    // Team B and Display connecting only now (after the action already
    // happened) must see the identical gameId too — same game, same id,
    // regardless of connection order.
    const teamBSocket = connect(teamB.token);
    const displaySocket = connect(display.token);
    const [teamBSnapshot, displaySnapshot] = await Promise.all([
      waitForState(teamBSocket),
      waitForState(displaySocket),
    ]);
    expect(teamBSnapshot.gameId).toBe(initialSnapshot.gameId);
    expect(displaySnapshot.gameId).toBe(initialSnapshot.gameId);

    hostSocket.close();
    teamASocket.close();
    teamBSocket.close();
    displaySocket.close();
  });

  it("rejects a socket connecting with an invalid token, same as chat", async () => {
    const socket = connect("not-a-real-token");
    const error = await new Promise<Error>((resolve) => socket.on("connect_error", resolve));
    expect(error.message).toBe("INVALID_TOKEN");
    socket.close();
  });

  describe("presence (src/server/sockets/presence.ts — powers the Quick Demo's connected-count)", () => {
    interface PresenceSnapshot {
      participants: { participantId: string; role: string; displayName: string }[];
    }

    function trackPresence(socket: ClientSocket) {
      const received: PresenceSnapshot[] = [];
      socket.on("presence:update", (s: PresenceSnapshot) => received.push(s));
      return {
        async settle(): Promise<PresenceSnapshot> {
          await new Promise((resolve) => setTimeout(resolve, 150));
          const last = received[received.length - 1];
          if (!last) throw new Error("expected at least one presence:update event, got none");
          return last;
        },
      };
    }

    it("reports who's connected, and drops them on disconnect", async () => {
      const { host, teamA, display } = await setUpSessionWithGame();
      const hostSocket = connect(host.token);
      const hostPresence = trackPresence(hostSocket);
      await waitForConnect(hostSocket);

      const afterHost = await hostPresence.settle();
      expect(afterHost.participants).toHaveLength(1);
      expect(afterHost.participants[0]?.role).toBe("HOST");

      const teamASocket = connect(teamA.token);
      const displaySocket = connect(display.token);
      await Promise.all([teamASocket, displaySocket].map(waitForConnect));

      const afterAll = await hostPresence.settle();
      expect(afterAll.participants).toHaveLength(3);
      expect(new Set(afterAll.participants.map((p) => p.role))).toEqual(new Set(["HOST", "TEAM_A", "DISPLAY"]));

      teamASocket.close();
      const afterDrop = await hostPresence.settle();
      expect(afterDrop.participants).toHaveLength(2);
      expect(afterDrop.participants.some((p) => p.role === "TEAM_A")).toBe(false);

      hostSocket.close();
      displaySocket.close();
    });

    it("one participant with two open tabs only counts once, and only disappears once BOTH close", async () => {
      const { host, display } = await setUpSessionWithGame();
      const tab1 = connect(host.token);
      const tab2 = connect(host.token); // same token, a second tab for the same participant
      // A third, unrelated connection to observe from — tab1 itself can't
      // observe what happens AFTER tab1 closes.
      const observerSocket = connect(display.token);
      const tracker = trackPresence(observerSocket);
      await Promise.all([tab1, tab2, observerSocket].map(waitForConnect));

      const afterBoth = await tracker.settle();
      expect(afterBoth.participants).toHaveLength(2); // HOST (once, not twice) + DISPLAY

      tab1.close();
      const afterOneClosed = await tracker.settle();
      expect(afterOneClosed.participants).toHaveLength(2); // tab2 still holds HOST's presence open

      tab2.close();
      const afterBothClosed = await tracker.settle();
      expect(afterBothClosed.participants).toHaveLength(1); // now only DISPLAY remains

      observerSocket.close();
    });
  });
});
