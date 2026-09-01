import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { createSocketServer } from "@/server/sockets";
import { broadcastGameSnapshot } from "@/server/sockets/game";
import { createSession } from "@/server/db/session";
import { joinSession } from "@/server/db/participant";
import { startGame } from "@/server/game";
import { sampleGuessThePricePlaylist } from "@/domain/game/guessThePrice";
import { prisma } from "@/server/db/client";

interface PriceSnapshot {
  gameId: string;
  gameKey: string;
  state: {
    status: string;
    phase: string;
    currentRoundIndex: number;
    buzzedTeam: string | null;
    submittedGuess: number | null;
    attemptedTeams: string[];
    scores: { TEAM_A: number; TEAM_B: number };
    winner: string | null;
    rounds: { id: string; title: string | null; imageUrl: string | null; price: number | null; marginPercent: number | null }[];
  };
  events: { type: string }[];
}

/**
 * Full vertical slice, real Socket.IO transport, for "Guess the Price" —
 * the counterpart to music-socket.test.ts, focused on what's genuinely
 * new here: the item (title/imageUrl) is public to every role the
 * INSTANT a round starts — there's no progressive reveal to pace, unlike
 * SteamRatingsEngine's `revealedCount` — and only `price`/`marginPercent`
 * are ever redacted, over a real per-role broadcast. Same
 * BUZZ -> SUBMIT_ANSWER -> JUDGE_ANSWER + steal mechanic as MusicEngine,
 * `guess` a float instead of free text ("ça peut être un float") — a
 * deliberate reversal of this engine's first pass, which reused
 * SteamRatingsEngine's oral/no-SUBMIT_ANSWER posture verbatim. No
 * ephemeral socket layer of its own — every action here rides the exact
 * same generic `game:action`/`game:state` path GeoGuessr/BoardQuestion/
 * Music/SteamRatings already use (src/server/sockets/game.ts), so this
 * file never touches that file itself. No other game's own socket test
 * file is touched.
 */
describe("Guess the Price vertical slice (Socket.IO: public item / hidden price, buzz/steal)", () => {
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

    const started = await startGame(session.id, "guessThePrice", sampleGuessThePricePlaylist);
    if (!started.ok) throw new Error("setup failed to start game");
    broadcastGameSnapshot(io, session.id, started.gameId, started.gameKey, started.state, started.events);

    return { sessionId: session.id, host, teamA, teamB, display };
  }

  /** Attached synchronously, right after `connect()` — see geoguessr-socket.test.ts's identical `waitForState` doc comment for why timing here matters. */
  function waitForState(socket: ClientSocket): Promise<PriceSnapshot> {
    return new Promise((resolve) => socket.once("game:state", resolve));
  }

  function waitForStateWhere(socket: ClientSocket, predicate: (snapshot: PriceSnapshot) => boolean): Promise<PriceSnapshot> {
    return new Promise((resolve) => {
      function handler(snapshot: PriceSnapshot) {
        if (!predicate(snapshot)) return;
        socket.off("game:state", handler);
        resolve(snapshot);
      }
      socket.on("game:state", handler);
    });
  }

  function sendAction(socket: ClientSocket, action: Record<string, unknown>) {
    return new Promise<{ ok: boolean; error?: { code: string; message: string }; state?: PriceSnapshot["state"] }>((resolve) => {
      socket.emit("game:action", action, resolve);
    });
  }

  it("a freshly connecting socket receives the current snapshot — the item is public, but price/margin are hidden from non-host roles", async () => {
    const { host, teamA } = await setUpSessionWithGame();
    const hostSocket = connect(host.token);
    const hostState = waitForState(hostSocket);
    const teamASocket = connect(teamA.token);
    const teamAState = waitForState(teamASocket);

    const hostSnapshot = await hostState;
    expect(hostSnapshot.state.phase).toBe("guessing");
    expect(hostSnapshot.state.rounds[0]!.title).toBe(sampleGuessThePricePlaylist.rounds[0]!.title); // HOST sees the real answer
    expect(hostSnapshot.state.rounds[0]!.price).toBe(sampleGuessThePricePlaylist.rounds[0]!.price);

    const teamASnapshot = await teamAState;
    expect(teamASnapshot.state.rounds[0]!.title).toBe(sampleGuessThePricePlaylist.rounds[0]!.title); // item is public from the start
    expect(teamASnapshot.state.rounds[0]!.imageUrl).toBe(sampleGuessThePricePlaylist.rounds[0]!.imageUrl);
    expect(teamASnapshot.state.rounds[0]!.price).toBeNull(); // only the price is secret
    expect(teamASnapshot.state.rounds[1]!.title).toBeNull(); // a future round is still fully blanked
  });

  it("BUZZ is legal the instant a round starts — no reveal step to wait on", async () => {
    const { host, teamA } = await setUpSessionWithGame();
    const hostSocket = connect(host.token);
    const socketA = connect(teamA.token);
    await Promise.all([hostSocket, socketA].map(waitForConnect));

    const buzz = await sendAction(socketA, { type: "BUZZ" });
    expect(buzz.ok).toBe(true);
    expect(buzz.state?.buzzedTeam).toBe("TEAM_A");
  });

  it("SUBMIT_ANSWER accepts a float guess and broadcasts it to every role, including Display; JUDGE_ANSWER is rejected before it lands", async () => {
    const { host, teamA, display } = await setUpSessionWithGame();
    const hostSocket = connect(host.token);
    const socketA = connect(teamA.token);
    const displaySocket = connect(display.token);
    await Promise.all([hostSocket, socketA, displaySocket].map(waitForConnect));

    await sendAction(socketA, { type: "BUZZ" });

    const tooEarly = await sendAction(hostSocket, { type: "JUDGE_ANSWER", correct: true });
    expect(tooEarly.ok).toBe(false);
    expect(tooEarly.error?.code).toBe("ANSWER_NOT_SUBMITTED");

    const displaySeesGuess = waitForStateWhere(displaySocket, (s) => s.state.submittedGuess !== null);
    const submitted = await sendAction(socketA, { type: "SUBMIT_ANSWER", guess: 44.5 });
    expect(submitted.ok).toBe(true);
    expect(submitted.state?.submittedGuess).toBe(44.5);

    const displaySnapshot = await displaySeesGuess;
    expect(displaySnapshot.state.submittedGuess).toBe(44.5); // visible to Display too, same posture as buzzedTeam
  });

  it("a correct judgment reveals the real price to Display and awards the point; DISPLAY can never act", async () => {
    const { host, teamA, display } = await setUpSessionWithGame();
    const hostSocket = connect(host.token);
    const socketA = connect(teamA.token);
    const displaySocket = connect(display.token);
    await Promise.all([hostSocket, socketA, displaySocket].map(waitForConnect));

    const displayGetsRevealed = waitForStateWhere(displaySocket, (s) => s.state.phase === "revealed");

    const buzzRejectedForDisplay = await sendAction(displaySocket, { type: "BUZZ" });
    expect(buzzRejectedForDisplay.ok).toBe(false);
    expect(buzzRejectedForDisplay.error?.code).toBe("FORBIDDEN_ROLE");

    await sendAction(socketA, { type: "BUZZ" });
    await sendAction(socketA, { type: "SUBMIT_ANSWER", guess: 49.99 });
    const judged = await sendAction(hostSocket, { type: "JUDGE_ANSWER", correct: true });
    expect(judged.ok).toBe(true);
    expect(judged.state?.phase).toBe("revealed");
    expect(judged.state?.submittedGuess).toBeNull(); // cleared once the round closes
    expect(judged.state?.scores).toEqual({ TEAM_A: 1, TEAM_B: 0 });

    const displaySnapshot = await displayGetsRevealed;
    expect(displaySnapshot.state.rounds[0]!.price).toBe(sampleGuessThePricePlaylist.rounds[0]!.price);
    expect(displaySnapshot.state.rounds[0]!.marginPercent).toBe(sampleGuessThePricePlaylist.rounds[0]!.marginPercent ?? null);
  });

  it("a wrong answer opens a real steal to the other team over separate sockets — a successful steal awards TEAM_B", async () => {
    const { host, teamA, teamB } = await setUpSessionWithGame();
    const hostSocket = connect(host.token);
    const socketA = connect(teamA.token);
    const socketB = connect(teamB.token);
    await Promise.all([hostSocket, socketA, socketB].map(waitForConnect));

    await sendAction(socketA, { type: "BUZZ" });
    await sendAction(socketA, { type: "SUBMIT_ANSWER", guess: 10 });
    const wrongJudged = await sendAction(hostSocket, { type: "JUDGE_ANSWER", correct: false });
    expect(wrongJudged.ok).toBe(true);
    expect(wrongJudged.state?.phase).toBe("guessing"); // reopened, not revealed
    expect(wrongJudged.state?.submittedGuess).toBeNull();
    expect(wrongJudged.state?.attemptedTeams).toEqual(["TEAM_A"]);

    // TEAM_A can't buzz again this round; TEAM_B (the real steal) can.
    const secondAttemptByA = await sendAction(socketA, { type: "BUZZ" });
    expect(secondAttemptByA.ok).toBe(false);
    expect(secondAttemptByA.error?.code).toBe("TEAM_ALREADY_ATTEMPTED");

    const steal = await sendAction(socketB, { type: "BUZZ" });
    expect(steal.ok).toBe(true);
    await sendAction(socketB, { type: "SUBMIT_ANSWER", guess: 49.99 });
    const stealJudged = await sendAction(hostSocket, { type: "JUDGE_ANSWER", correct: true });
    expect(stealJudged.ok).toBe(true);
    expect(stealJudged.state?.scores).toEqual({ TEAM_A: 0, TEAM_B: 1 });
  });

  it("SKIP_ROUND is legal from the very start of a round, then NEXT_ROUND advances", async () => {
    const { host } = await setUpSessionWithGame();
    const hostSocket = connect(host.token);
    await waitForConnect(hostSocket);

    const skipped = await sendAction(hostSocket, { type: "SKIP_ROUND" });
    expect(skipped.ok).toBe(true);
    expect(skipped.state?.phase).toBe("revealed");
    expect(skipped.state?.scores).toEqual({ TEAM_A: 0, TEAM_B: 0 });

    const advanced = await sendAction(hostSocket, { type: "NEXT_ROUND" });
    expect(advanced.ok).toBe(true);
    expect(advanced.state?.currentRoundIndex).toBe(1);
    expect(advanced.state?.phase).toBe("guessing");

    const finished = await sendAction(hostSocket, { type: "SKIP_ROUND" }); // last round -> game ends
    expect(finished.ok).toBe(true);
    expect(finished.state?.status).toBe("finished");
    expect(finished.state?.winner).toBe("TIE");
  });

  it("reconnect mid-round recovers the live state — a fresh socket for the same participant sees the same phase/buzz/guess/scores", async () => {
    const { host, teamA } = await setUpSessionWithGame();
    const hostSocket = connect(host.token);
    const socketAa = connect(teamA.token);
    await Promise.all([hostSocket, socketAa].map(waitForConnect));

    await sendAction(socketAa, { type: "BUZZ" });
    await sendAction(socketAa, { type: "SUBMIT_ANSWER", guess: 39.99 });

    // A "page reload" — a brand-new socket for the exact same participant token.
    socketAa.close();
    const socketAb = connect(teamA.token);
    const resync = await waitForState(socketAb);
    expect(resync.state.phase).toBe("answering");
    expect(resync.state.buzzedTeam).toBe("TEAM_A");
    expect(resync.state.submittedGuess).toBe(39.99);
  });
});
