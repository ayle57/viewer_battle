import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { createSocketServer } from "@/server/sockets";
import { broadcastGameSnapshot } from "@/server/sockets/game";
import { createSession } from "@/server/db/session";
import { joinSession } from "@/server/db/participant";
import { startGame } from "@/server/game";
import { sampleDrawingPlaylist } from "@/domain/game/drawing";
import { prisma } from "@/server/db/client";

interface DrawingSnapshot {
  gameId: string;
  gameKey: string;
  state: {
    status: string;
    phase: string;
    currentPromptIndex: number;
    activeTeam: string;
    drawerName: string | null;
    prompts: { id: string; text: string; durationSeconds: number }[];
    scores: { TEAM_A: number; TEAM_B: number };
    winner: string | null;
    countdownDeadline: number | null;
  };
  events: { type: string }[];
}

interface Stroke {
  points: { x: number; y: number }[];
  color: string;
  width: number;
}

/**
 * Full vertical slice, real Socket.IO transport, for Drawing's ephemeral
 * canvas layer (src/server/sockets/drawing.ts) — the counterpart to
 * geoguessr-socket.test.ts, focused on what's genuinely new here: a
 * secret only the DRAWER (not their own teammate) ever sees, live
 * strokes scoped to exactly one team + host, and a pull-based snapshot
 * that self-heals into "reveal" the instant the round leaves "drawing".
 * Jeopardy's/GeoGuessr's own socket test files are untouched.
 */
describe("Drawing vertical slice (ephemeral canvas: drawer-only strokes, teammate/host live view, reveal, reconnect)", () => {
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

    const host = await joinSession({ sessionCode: session.code, role: "HOST", displayName: "Streamer" });
    const { ready } = connectAndWaitForPresence(host.token);
    await ready;

    const teamA1 = await joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "A1" });
    const teamA2 = await joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "A2" });
    const teamB1 = await joinSession({ sessionCode: session.code, role: "TEAM_B", displayName: "B1" });
    const display = await joinSession({ sessionCode: session.code, role: "DISPLAY", displayName: "OBS" });

    const started = await startGame(session.id, "drawing", sampleDrawingPlaylist);
    if (!started.ok) throw new Error("setup failed to start game");
    broadcastGameSnapshot(io, session.id, started.gameId, started.gameKey, started.state, started.events);

    return { sessionId: session.id, host, teamA1, teamA2, teamB1, display };
  }

  /** For a socket's OWN connect-time resync snapshot — must be attached synchronously, right after `connect()`, before any `await` (same reasoning as geoguessr-socket.test.ts's own `waitForState`/`waitForStateWhere` doc comment: the server's async `sendCurrentSnapshot` can otherwise complete and emit before a listener attached after an `await` ever gets registered). */
  function waitForState(socket: ClientSocket): Promise<DrawingSnapshot> {
    return new Promise((resolve) => socket.once("game:state", resolve));
  }

  function sendAction(socket: ClientSocket, action: Record<string, unknown>) {
    return new Promise<{ ok: boolean; error?: { code: string; message: string }; state?: DrawingSnapshot["state"] }>((resolve) => {
      socket.emit("game:action", action, resolve);
    });
  }

  function chooseDrawer(socket: ClientSocket) {
    return sendAction(socket, { type: "CHOOSE_DRAWER" });
  }

  function sendStroke(socket: ClientSocket, stroke: Stroke = { points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }], color: "#fff", width: 4 }) {
    return new Promise<{ ok: boolean; error?: string }>((resolve) => socket.emit("drawing:stroke", stroke, resolve));
  }

  function clearCanvas(socket: ClientSocket) {
    return new Promise<{ ok: boolean; error?: string }>((resolve) => socket.emit("drawing:clear", {}, resolve));
  }

  function undoStroke(socket: ClientSocket) {
    return new Promise<{ ok: boolean; error?: string }>((resolve) => socket.emit("drawing:undo", {}, resolve));
  }

  function requestSnapshot(socket: ClientSocket) {
    return new Promise<{ strokes: Stroke[] }>((resolve) => socket.emit("drawing:request-snapshot", {}, resolve));
  }

  function requestPrompt(socket: ClientSocket) {
    return new Promise<{ text: string | null }>((resolve) => socket.emit("drawing:request-prompt", {}, resolve));
  }

  it("a freshly connecting socket receives the current game snapshot, prompt text blanked", async () => {
    const { host, teamA1 } = await setUpSessionWithGame();
    const hostSocket = connect(host.token);
    const hostState = waitForState(hostSocket); // attached synchronously, right after connect — see waitForState's own doc comment
    const teamASocket = connect(teamA1.token);
    const teamAState = waitForState(teamASocket);

    const hostSnapshot = await hostState;
    expect(hostSnapshot.state.phase).toBe("choosing_drawer");
    expect(hostSnapshot.state.prompts[0]!.text).toBe(sampleDrawingPlaylist.prompts[0]!.text); // HOST sees the real word

    const teamASnapshot = await teamAState;
    expect(teamASnapshot.state.prompts[0]!.text).toBe(""); // blanked for the team, even before a drawer is chosen
  });

  it("CHOOSE_DRAWER is a real race — the second teammate's claim loses", async () => {
    const { teamA1, teamA2 } = await setUpSessionWithGame();
    const socketA1 = connect(teamA1.token);
    const socketA2 = connect(teamA2.token);
    await Promise.all([socketA1, socketA2].map(waitForConnect));

    const [ackA1, ackA2] = await Promise.all([chooseDrawer(socketA1), chooseDrawer(socketA2)]);
    const results = [ackA1, ackA2];
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(1);
  });

  it("only the chosen drawer may send strokes — not their own teammate, not the opposing team, not host", async () => {
    const { host, teamA1, teamA2, teamB1 } = await setUpSessionWithGame();
    const hostSocket = connect(host.token);
    const socketA1 = connect(teamA1.token); // A1 will become drawer
    const socketA2 = connect(teamA2.token); // A1's teammate — must NOT be able to draw
    const socketB1 = connect(teamB1.token);
    await Promise.all([hostSocket, socketA1, socketA2, socketB1].map(waitForConnect));

    const chosen = await chooseDrawer(socketA1);
    expect(chosen.ok).toBe(true);

    const teammateAttempt = await sendStroke(socketA2);
    expect(teammateAttempt.ok).toBe(false);
    const opponentAttempt = await sendStroke(socketB1);
    expect(opponentAttempt.ok).toBe(false);
    const hostAttempt = await sendStroke(hostSocket);
    expect(hostAttempt.ok).toBe(false);

    const drawerAttempt = await sendStroke(socketA1);
    expect(drawerAttempt.ok).toBe(true);
  });

  it("live strokes reach the teammate and host in real time; NOT the opposing team or Display", async () => {
    const { host, teamA1, teamA2, teamB1, display } = await setUpSessionWithGame();
    const hostSocket = connect(host.token);
    const socketA1 = connect(teamA1.token);
    const socketA2 = connect(teamA2.token);
    const socketB1 = connect(teamB1.token);
    const displaySocket = connect(display.token);
    await Promise.all([hostSocket, socketA1, socketA2, socketB1, displaySocket].map(waitForConnect));

    await chooseDrawer(socketA1);

    const teammateGotIt = new Promise<Stroke>((resolve) => socketA2.once("drawing:stroke", resolve));
    const hostGotIt = new Promise<Stroke>((resolve) => hostSocket.once("drawing:stroke", resolve));
    let opponentGotIt = false;
    let displayGotIt = false;
    socketB1.once("drawing:stroke", () => {
      opponentGotIt = true;
    });
    displaySocket.once("drawing:stroke", () => {
      displayGotIt = true;
    });

    const stroke: Stroke = { points: [{ x: 0.3, y: 0.4 }, { x: 0.5, y: 0.6 }], color: "#000", width: 6 };
    const ack = await sendStroke(socketA1, stroke);
    expect(ack.ok).toBe(true);

    expect(await teammateGotIt).toEqual(stroke);
    expect(await hostGotIt).toEqual(stroke);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(opponentGotIt).toBe(false);
    expect(displayGotIt).toBe(false);
  });

  it("drawing:request-snapshot hides strokes from the opposing team/Display while still drawing, and reveals them once the round moves to 'guessing'", async () => {
    const { host, teamA1, teamB1, display } = await setUpSessionWithGame();
    const hostSocket = connect(host.token);
    const socketA1 = connect(teamA1.token);
    const socketB1 = connect(teamB1.token);
    const displaySocket = connect(display.token);
    await Promise.all([hostSocket, socketA1, socketB1, displaySocket].map(waitForConnect));

    await chooseDrawer(socketA1);
    const stroke: Stroke = { points: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.9 }], color: "#f00", width: 2 };
    await sendStroke(socketA1, stroke);

    // Still drawing: opponent/Display get nothing back.
    expect((await requestSnapshot(socketB1)).strokes).toEqual([]);
    expect((await requestSnapshot(displaySocket)).strokes).toEqual([]);
    // HOST and the active team's own drawer DO see it.
    expect((await requestSnapshot(hostSocket)).strokes).toEqual([stroke]);
    expect((await requestSnapshot(socketA1)).strokes).toEqual([stroke]);

    // Force the timer to expire — moves phase to "guessing".
    const expired = await sendAction(hostSocket, { type: "COUNTDOWN_EXPIRED" });
    expect(expired.ok).toBe(true);
    expect(expired.state?.phase).toBe("guessing");

    // Now it's safe to reveal — everyone gets the real strokes.
    expect((await requestSnapshot(socketB1)).strokes).toEqual([stroke]);
    expect((await requestSnapshot(displaySocket)).strokes).toEqual([stroke]);
  });

  it("drawing:request-prompt only ever serves the actual drawer — never the teammate, opposing team, or host (host already has it via game:state)", async () => {
    const { host, teamA1, teamA2, teamB1 } = await setUpSessionWithGame();
    const socketA1 = connect(teamA1.token);
    const socketA2 = connect(teamA2.token);
    const socketB1 = connect(teamB1.token);
    const hostSocket = connect(host.token);
    await Promise.all([socketA1, socketA2, socketB1, hostSocket].map(waitForConnect));

    // Before a drawer is chosen: nobody gets it, not even the eventual drawer.
    expect((await requestPrompt(socketA1)).text).toBeNull();

    await chooseDrawer(socketA1);

    expect((await requestPrompt(socketA1)).text).toBe(sampleDrawingPlaylist.prompts[0]!.text);
    expect((await requestPrompt(socketA2)).text).toBeNull(); // the drawer's own teammate — must NOT know the word
    expect((await requestPrompt(socketB1)).text).toBeNull();
    expect((await requestPrompt(hostSocket)).text).toBeNull(); // host doesn't need this channel — already unredacted via game:state
  });

  it("drawing:clear empties the buffer for everyone currently allowed to see it", async () => {
    const { teamA1, teamA2 } = await setUpSessionWithGame();
    const socketA1 = connect(teamA1.token);
    const socketA2 = connect(teamA2.token);
    await Promise.all([socketA1, socketA2].map(waitForConnect));
    await chooseDrawer(socketA1);
    await sendStroke(socketA1);
    expect((await requestSnapshot(socketA1)).strokes).toHaveLength(1);

    const teammateSawClear = new Promise<void>((resolve) => socketA2.once("drawing:clear", () => resolve()));
    const clearAck = await clearCanvas(socketA1);
    expect(clearAck.ok).toBe(true);
    await teammateSawClear;

    expect((await requestSnapshot(socketA1)).strokes).toEqual([]);
  });

  it("drawing:undo drops only the most recent stroke, broadcasting to everyone currently allowed to see it", async () => {
    const { teamA1, teamA2 } = await setUpSessionWithGame();
    const socketA1 = connect(teamA1.token);
    const socketA2 = connect(teamA2.token);
    await Promise.all([socketA1, socketA2].map(waitForConnect));
    await chooseDrawer(socketA1);

    const stroke1: Stroke = { points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }], color: "#111", width: 3 };
    const stroke2: Stroke = { points: [{ x: 0.3, y: 0.3 }, { x: 0.4, y: 0.4 }], color: "#222", width: 3 };
    await sendStroke(socketA1, stroke1);
    await sendStroke(socketA1, stroke2);
    expect((await requestSnapshot(socketA1)).strokes).toEqual([stroke1, stroke2]);

    const teammateSawUndo = new Promise<void>((resolve) => socketA2.once("drawing:undo", () => resolve()));
    const undoAck = await undoStroke(socketA1);
    expect(undoAck.ok).toBe(true);
    await teammateSawUndo;

    expect((await requestSnapshot(socketA1)).strokes).toEqual([stroke1]);

    // Undoing on an already-empty-of-that-stroke buffer is a no-op, not
    // an error — same posture as clearCanvas on an empty buffer.
    await undoStroke(socketA1);
    const finalUndoAck = await undoStroke(socketA1);
    expect(finalUndoAck.ok).toBe(true);
    expect((await requestSnapshot(socketA1)).strokes).toEqual([]);
  });

  it("only the chosen drawer may undo — not their own teammate, not the opposing team, not host", async () => {
    const { host, teamA1, teamA2, teamB1 } = await setUpSessionWithGame();
    const socketA1 = connect(teamA1.token);
    const socketA2 = connect(teamA2.token);
    const socketB1 = connect(teamB1.token);
    const hostSocket = connect(host.token);
    await Promise.all([socketA1, socketA2, socketB1, hostSocket].map(waitForConnect));
    await chooseDrawer(socketA1);
    await sendStroke(socketA1);

    const teammateAck = await undoStroke(socketA2);
    expect(teammateAck.ok).toBe(false);
    const opposingAck = await undoStroke(socketB1);
    expect(opposingAck.ok).toBe(false);
    const hostAck = await undoStroke(hostSocket);
    expect(hostAck.ok).toBe(false);

    // Nothing above actually removed the one real stroke.
    expect((await requestSnapshot(socketA1)).strokes).toHaveLength(1);
  });

  it("reconnect mid-round recovers the current canvas — a fresh socket for the drawer's own teammate pulls the same live strokes", async () => {
    const { teamA1, teamA2 } = await setUpSessionWithGame();
    const socketA1 = connect(teamA1.token);
    const socketA2a = connect(teamA2.token);
    await Promise.all([socketA1, socketA2a].map(waitForConnect));
    await chooseDrawer(socketA1);

    const stroke1: Stroke = { points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }], color: "#111", width: 3 };
    const stroke2: Stroke = { points: [{ x: 0.3, y: 0.3 }, { x: 0.4, y: 0.4 }], color: "#222", width: 3 };
    await sendStroke(socketA1, stroke1);
    await sendStroke(socketA1, stroke2);

    // Teammate "refreshes" — a brand-new socket for the same participant.
    socketA2a.close();
    const socketA2b = connect(teamA2.token);
    await waitForConnect(socketA2b);

    expect((await requestSnapshot(socketA2b)).strokes).toEqual([stroke1, stroke2]);
  });

  it("a new turn starts with a genuinely empty canvas, even though the previous round's buffer key is stale", async () => {
    const { host, teamA1, teamB1 } = await setUpSessionWithGame();
    const hostSocket = connect(host.token);
    const socketA1 = connect(teamA1.token);
    const socketB1 = connect(teamB1.token);
    await Promise.all([hostSocket, socketA1, socketB1].map(waitForConnect));

    await chooseDrawer(socketA1);
    await sendStroke(socketA1);
    await sendAction(hostSocket, { type: "COUNTDOWN_EXPIRED" });
    const judged = await sendAction(hostSocket, { type: "JUDGE_GUESS", correct: false }); // TEAM_B gets the point
    expect(judged.ok).toBe(true);
    expect(judged.state?.phase).toBe("resolved"); // the outcome pauses here now — see engine.ts's own doc comment

    const advanced = await sendAction(hostSocket, { type: "NEXT_PROMPT" }); // the Host paces on to TEAM_B's own turn
    expect(advanced.ok).toBe(true);
    expect(advanced.state?.activeTeam).toBe("TEAM_B");
    expect(advanced.state?.phase).toBe("choosing_drawer");

    const chosenB = await chooseDrawer(socketB1);
    expect(chosenB.ok).toBe(true);

    // Old buffer belonged to prompt 0 (TEAM_A's turn) — TEAM_B's fresh
    // turn (prompt 1) must not see TEAM_A's leftover stroke.
    expect((await requestSnapshot(socketB1)).strokes).toEqual([]);
  });

  it("ADJUST_COUNTDOWN retargets the real deadline over the actual socket — +10s and -10s both land, and over-removing clamps to the future", async () => {
    const { host, teamA1 } = await setUpSessionWithGame();
    const hostSocket = connect(host.token);
    const socketA1 = connect(teamA1.token);
    await Promise.all([hostSocket, socketA1].map(waitForConnect));

    const chosen = await chooseDrawer(socketA1);
    const originalDeadline = chosen.state?.countdownDeadline as number;
    expect(typeof originalDeadline).toBe("number");

    const extended = await sendAction(hostSocket, { type: "ADJUST_COUNTDOWN", deltaSeconds: 10 });
    expect(extended.ok).toBe(true);
    expect(extended.state?.countdownDeadline).toBe(originalDeadline + 10_000);

    const shortened = await sendAction(hostSocket, { type: "ADJUST_COUNTDOWN", deltaSeconds: -10 });
    expect(shortened.ok).toBe(true);
    expect(shortened.state?.countdownDeadline).toBe(originalDeadline);

    const overRemoved = await sendAction(hostSocket, { type: "ADJUST_COUNTDOWN", deltaSeconds: -999 });
    expect(overRemoved.ok).toBe(true);
    expect(overRemoved.state?.countdownDeadline).toBeGreaterThan(Date.now());
    expect(overRemoved.state?.countdownDeadline).toBeLessThan(originalDeadline);

    // A non-host is rejected — same authorization boundary as every other host-only action.
    const rejected = await sendAction(socketA1, { type: "ADJUST_COUNTDOWN", deltaSeconds: 10 });
    expect(rejected.ok).toBe(false);
    expect(rejected.error?.code).toBe("FORBIDDEN_ROLE");
  });
});
