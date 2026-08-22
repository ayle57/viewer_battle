import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { createSocketServer } from "@/server/sockets";
import { broadcastGameSnapshot } from "@/server/sockets/game";
import { createSession } from "@/server/db/session";
import { joinSession } from "@/server/db/participant";
import { startGame, applyGameAction, getCurrentGame } from "@/server/game";
import { sampleBoard } from "@/domain/game/boardQuestion";
import { prisma } from "@/server/db/client";

interface BoardSnapshot {
  gameId: string;
  gameKey: string;
  state: { status: string; winner: string | null; countdownDeadline: number | null };
  events: { type: string }[];
}

/**
 * The countdown feature, generalized from GeoGuessr to BoardQuestion/
 * Mini Jeopardy (src/domain/game/countdown.ts's own doc comment) — the
 * domain logic itself is already exhaustively covered by
 * boardQuestion/engine.test.ts (mirroring geoGuessr/engine.test.ts's own
 * coverage). This file proves the one thing only a real server process
 * can prove for THIS engine specifically: the shared server wiring
 * (game.ts's real-time timer, service.ts's lazy self-heal) — both
 * engine-agnostic and unchanged code paths — actually resolves a
 * BoardQuestion game's countdown correctly too, not just GeoGuessr's,
 * confirming the generalization is real and not just an assumption from
 * shared code. Deliberately NOT a full duplicate of every scenario
 * geoguessr-countdown.test.ts already covers (role checks, reconnect,
 * retargeting — all identical shared logic, already proven there) — just
 * the two paths that are worth a real, independent proof per engine.
 */
describe("BoardQuestion/Mini Jeopardy countdown-to-end (real timers, real transport)", () => {
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
  function waitForStateWhere(socket: ClientSocket, predicate: (snapshot: BoardSnapshot) => boolean): Promise<BoardSnapshot> {
    return new Promise((resolve) => {
      function handler(snapshot: BoardSnapshot) {
        if (!predicate(snapshot)) return;
        socket.off("game:state", handler);
        resolve(snapshot);
      }
      socket.on("game:state", handler);
    });
  }
  function sendAction(socket: ClientSocket, action: Record<string, unknown>) {
    return new Promise<{ ok: boolean; error?: { code: string; message: string } }>((resolve) => {
      socket.emit("game:action", action, resolve);
    });
  }

  async function setUpSessionWithGame() {
    const session = await createSession();
    createdSessionIds.add(session.id);
    const host = await joinSession({ sessionCode: session.code, role: "HOST", displayName: "Alex" });
    const hostSocket = connect(host.token);
    await new Promise<void>((resolve) => hostSocket.once("presence:update", () => resolve()));
    const teamA = await joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "A1" });

    const started = await startGame(session.id, "board-question", sampleBoard);
    if (!started.ok) throw new Error("setup failed to start game");
    broadcastGameSnapshot(io, session.id, started.gameId, started.gameKey, started.state, started.events);
    hostSocket.close();

    return { sessionId: session.id, host, teamA };
  }

  it("lazy self-heal: a countdown whose deadline has already passed auto-finishes the NEXT time the game is read, even with no client action and no real-time timer involved", async () => {
    const { sessionId } = await setUpSessionWithGame();
    const started = await applyGameAction(sessionId, { type: "START_COUNTDOWN", by: "HOST", durationMs: 10_000, nowMs: 0 });
    expect(started.ok).toBe(true);

    const game = await getCurrentGame(sessionId);
    expect(game?.status).toBe("FINISHED"); // unlike GeoGuessr's own per-round semantics, this engine has no round to advance to — expiring always just ends the game
    const state = game?.internalState as unknown as { winner: string | null; countdownDeadline: number | null };
    expect(state.winner).toBe("TIE"); // 0-0, nobody ever played
    expect(state.countdownDeadline).toBeNull();
  });

  it(
    "the real-time primary timer (gameEndTimers.ts + game.ts) genuinely fires on its own — no client ever sends COUNTDOWN_EXPIRED — and finishes the game for every connected role",
    async () => {
      const { host, teamA } = await setUpSessionWithGame();
      const hostSocket = connect(host.token);
      const teamASocket = connect(teamA.token);
      await Promise.all([hostSocket, teamASocket].map(waitForConnect));

      const finished = Promise.all([
        waitForStateWhere(hostSocket, (s) => s.state.status === "finished"),
        waitForStateWhere(teamASocket, (s) => s.state.status === "finished"),
      ]);

      const startResult = await sendAction(hostSocket, { type: "START_COUNTDOWN", durationMs: 10_000 });
      expect(startResult.ok).toBe(true);

      const [hostFinal, teamAFinal] = await finished;
      for (const snapshot of [hostFinal, teamAFinal]) {
        expect(snapshot.state.winner).toBe("TIE");
        expect(snapshot.state.countdownDeadline).toBeNull();
        expect(snapshot.events.some((e) => e.type === "GAME_FINISHED")).toBe(true);
      }
    },
    20_000,
  );
});
