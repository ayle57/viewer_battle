import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { createSocketServer } from "@/server/sockets";
import { broadcastGameSnapshot } from "@/server/sockets/game";
import { createSession } from "@/server/db/session";
import { joinSession } from "@/server/db/participant";
import { startGame } from "@/server/game";
import { sampleSteamRatingsPlaylist } from "@/domain/game/steamRatings";
import { prisma } from "@/server/db/client";

interface SteamSnapshot {
  gameId: string;
  gameKey: string;
  state: {
    status: string;
    phase: string;
    currentRoundIndex: number;
    revealedCount: number;
    buzzedTeam: string | null;
    attemptedTeams: string[];
    scores: { TEAM_A: number; TEAM_B: number };
    winner: string | null;
    rounds: { id: string; title: string | null; imageUrl: string | null; ratings: string[] }[];
  };
  events: { type: string }[];
}

/**
 * Full vertical slice, real Socket.IO transport, for "Guess the Game"
 * (Steam Ratings) — the counterpart to music-socket.test.ts, focused on
 * what's genuinely new here: the progressive, Host-paced reveal
 * (`revealedCount` climbing one rating at a time, never the whole array
 * up front) over a real per-role redacted broadcast, and the buzz/steal
 * mechanic — but with ORAL answers ("finalement les reponses du guess
 * the game seront orales"): JUDGE_ANSWER is legal the instant BUZZ
 * lands, no SUBMIT_ANSWER round trip exists in this engine at all. No
 * ephemeral socket layer of its own — every action here rides the exact
 * same generic `game:action`/`game:state` path GeoGuessr/BoardQuestion/
 * Music already use (src/server/sockets/game.ts), so this file never
 * touches that file itself. No other game's own socket test file is
 * touched.
 */
describe("Steam Ratings vertical slice (Socket.IO: progressive reveal, buzz/steal, image reveal)", () => {
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

    const started = await startGame(session.id, "steamRatings", sampleSteamRatingsPlaylist);
    if (!started.ok) throw new Error("setup failed to start game");
    broadcastGameSnapshot(io, session.id, started.gameId, started.gameKey, started.state, started.events);

    return { sessionId: session.id, host, teamA, teamB, display };
  }

  /** Attached synchronously, right after `connect()` — see geoguessr-socket.test.ts's identical `waitForState` doc comment for why timing here matters. */
  function waitForState(socket: ClientSocket): Promise<SteamSnapshot> {
    return new Promise((resolve) => socket.once("game:state", resolve));
  }

  function waitForStateWhere(socket: ClientSocket, predicate: (snapshot: SteamSnapshot) => boolean): Promise<SteamSnapshot> {
    return new Promise((resolve) => {
      function handler(snapshot: SteamSnapshot) {
        if (!predicate(snapshot)) return;
        socket.off("game:state", handler);
        resolve(snapshot);
      }
      socket.on("game:state", handler);
    });
  }

  function sendAction(socket: ClientSocket, action: Record<string, unknown>) {
    return new Promise<{ ok: boolean; error?: { code: string; message: string }; state?: SteamSnapshot["state"] }>((resolve) => {
      socket.emit("game:action", action, resolve);
    });
  }

  it("a freshly connecting socket receives the current snapshot — nothing revealed yet, no ratings visible to non-host roles", async () => {
    const { host, teamA } = await setUpSessionWithGame();
    const hostSocket = connect(host.token);
    const hostState = waitForState(hostSocket);
    const teamASocket = connect(teamA.token);
    const teamAState = waitForState(teamASocket);

    const hostSnapshot = await hostState;
    expect(hostSnapshot.state.phase).toBe("guessing");
    expect(hostSnapshot.state.revealedCount).toBe(0);
    expect(hostSnapshot.state.rounds[0]!.title).toBe(sampleSteamRatingsPlaylist.rounds[0]!.title); // HOST sees the real answer
    expect(hostSnapshot.state.rounds[0]!.ratings).toEqual(sampleSteamRatingsPlaylist.rounds[0]!.ratings); // HOST sees every rating, not just revealed ones

    const teamASnapshot = await teamAState;
    expect(teamASnapshot.state.rounds[0]!.ratings).toEqual([]); // nothing revealed yet
    expect(teamASnapshot.state.rounds[0]!.title).toBeNull();
    expect(teamASnapshot.state.rounds[0]!.imageUrl).toBeNull();
  });

  it("only the HOST may REVEAL_NEXT_RATING; each reveal grows every role's own ratings array by exactly one, in order", async () => {
    const { host, teamA, display } = await setUpSessionWithGame();
    const hostSocket = connect(host.token);
    const socketA = connect(teamA.token);
    const displaySocket = connect(display.token);
    await Promise.all([hostSocket, socketA, displaySocket].map(waitForConnect));

    const rejected = await sendAction(socketA, { type: "REVEAL_NEXT_RATING" });
    expect(rejected.ok).toBe(false);
    expect(rejected.error?.code).toBe("FORBIDDEN_ROLE");

    const teamASeesFirst = waitForStateWhere(socketA, (s) => s.state.rounds[0]!.ratings.length === 1);
    const displaySeesFirst = waitForStateWhere(displaySocket, (s) => s.state.rounds[0]!.ratings.length === 1);
    const revealed = await sendAction(hostSocket, { type: "REVEAL_NEXT_RATING" });
    expect(revealed.ok).toBe(true);
    expect(revealed.state?.revealedCount).toBe(1);

    const teamASnapshot = await teamASeesFirst;
    expect(teamASnapshot.state.rounds[0]!.ratings).toEqual([sampleSteamRatingsPlaylist.rounds[0]!.ratings[0]]);
    expect(teamASnapshot.state.rounds[0]!.title).toBeNull(); // still the answer, still hidden

    const displaySnapshot = await displaySeesFirst;
    expect(displaySnapshot.state.rounds[0]!.ratings).toEqual([sampleSteamRatingsPlaylist.rounds[0]!.ratings[0]]);

    const secondReveal = await sendAction(hostSocket, { type: "REVEAL_NEXT_RATING" });
    expect(secondReveal.ok).toBe(true);
    expect(secondReveal.state?.revealedCount).toBe(2);
  });

  it("BUZZ is rejected before anything is revealed; becomes legal the instant the first rating is revealed", async () => {
    const { host, teamA } = await setUpSessionWithGame();
    const hostSocket = connect(host.token);
    const socketA = connect(teamA.token);
    await Promise.all([hostSocket, socketA].map(waitForConnect));

    const tooEarly = await sendAction(socketA, { type: "BUZZ" });
    expect(tooEarly.ok).toBe(false);
    expect(tooEarly.error?.code).toBe("NOTHING_REVEALED_YET");

    await sendAction(hostSocket, { type: "REVEAL_NEXT_RATING" });
    const buzz = await sendAction(socketA, { type: "BUZZ" });
    expect(buzz.ok).toBe(true);
    expect(buzz.state?.buzzedTeam).toBe("TEAM_A");
  });

  it("REVEAL_NEXT_RATING is rejected once a team has buzzed (paused during 'answering')", async () => {
    const { host, teamA } = await setUpSessionWithGame();
    const hostSocket = connect(host.token);
    const socketA = connect(teamA.token);
    await Promise.all([hostSocket, socketA].map(waitForConnect));

    await sendAction(hostSocket, { type: "REVEAL_NEXT_RATING" });
    await sendAction(socketA, { type: "BUZZ" });
    const rejected = await sendAction(hostSocket, { type: "REVEAL_NEXT_RATING" });
    expect(rejected.ok).toBe(false);
    expect(rejected.error?.code).toBe("WRONG_PHASE");
  });

  it("a correct judgment reveals the real title AND cover image to Display and awards the point; DISPLAY can never act", async () => {
    const { host, teamA, display } = await setUpSessionWithGame();
    const hostSocket = connect(host.token);
    const socketA = connect(teamA.token);
    const displaySocket = connect(display.token);
    await Promise.all([hostSocket, socketA, displaySocket].map(waitForConnect));

    const displayGetsRevealed = waitForStateWhere(displaySocket, (s) => s.state.phase === "revealed");

    await sendAction(hostSocket, { type: "REVEAL_NEXT_RATING" });
    const buzzRejectedForDisplay = await sendAction(displaySocket, { type: "BUZZ" });
    expect(buzzRejectedForDisplay.ok).toBe(false);
    expect(buzzRejectedForDisplay.error?.code).toBe("FORBIDDEN_ROLE");

    await sendAction(socketA, { type: "BUZZ" });
    const judged = await sendAction(hostSocket, { type: "JUDGE_ANSWER", correct: true });
    expect(judged.ok).toBe(true);
    expect(judged.state?.phase).toBe("revealed");
    expect(judged.state?.scores).toEqual({ TEAM_A: 1, TEAM_B: 0 });

    const displaySnapshot = await displayGetsRevealed;
    expect(displaySnapshot.state.rounds[0]!.title).toBe(sampleSteamRatingsPlaylist.rounds[0]!.title);
    expect(displaySnapshot.state.rounds[0]!.imageUrl).toBe(sampleSteamRatingsPlaylist.rounds[0]!.imageUrl);
    expect(displaySnapshot.state.rounds[0]!.ratings).toEqual(sampleSteamRatingsPlaylist.rounds[0]!.ratings); // fully public once revealed, not just what was shown live
  });

  it("a wrong answer opens a real steal to the other team over separate sockets — a successful steal awards TEAM_B", async () => {
    const { host, teamA, teamB } = await setUpSessionWithGame();
    const hostSocket = connect(host.token);
    const socketA = connect(teamA.token);
    const socketB = connect(teamB.token);
    await Promise.all([hostSocket, socketA, socketB].map(waitForConnect));

    await sendAction(hostSocket, { type: "REVEAL_NEXT_RATING" });
    await sendAction(socketA, { type: "BUZZ" });
    const wrongJudged = await sendAction(hostSocket, { type: "JUDGE_ANSWER", correct: false });
    expect(wrongJudged.ok).toBe(true);
    expect(wrongJudged.state?.phase).toBe("guessing"); // reopened, not revealed
    expect(wrongJudged.state?.attemptedTeams).toEqual(["TEAM_A"]);

    // TEAM_A can't buzz again this round; TEAM_B (the real steal) can.
    const secondAttemptByA = await sendAction(socketA, { type: "BUZZ" });
    expect(secondAttemptByA.ok).toBe(false);
    expect(secondAttemptByA.error?.code).toBe("TEAM_ALREADY_ATTEMPTED");

    const steal = await sendAction(socketB, { type: "BUZZ" });
    expect(steal.ok).toBe(true);
    const stealJudged = await sendAction(hostSocket, { type: "JUDGE_ANSWER", correct: true });
    expect(stealJudged.ok).toBe(true);
    expect(stealJudged.state?.scores).toEqual({ TEAM_A: 0, TEAM_B: 1 });
  });

  it("SKIP_ROUND is rejected before anything is revealed, legal once at least one rating is out, then NEXT_ROUND advances", async () => {
    const { host } = await setUpSessionWithGame();
    const hostSocket = connect(host.token);
    await waitForConnect(hostSocket);

    const tooEarly = await sendAction(hostSocket, { type: "SKIP_ROUND" });
    expect(tooEarly.ok).toBe(false);
    expect(tooEarly.error?.code).toBe("NOTHING_REVEALED_YET");

    await sendAction(hostSocket, { type: "REVEAL_NEXT_RATING" });
    const skipped = await sendAction(hostSocket, { type: "SKIP_ROUND" });
    expect(skipped.ok).toBe(true);
    expect(skipped.state?.phase).toBe("revealed");
    expect(skipped.state?.scores).toEqual({ TEAM_A: 0, TEAM_B: 0 });

    const advanced = await sendAction(hostSocket, { type: "NEXT_ROUND" });
    expect(advanced.ok).toBe(true);
    expect(advanced.state?.currentRoundIndex).toBe(1);
    expect(advanced.state?.phase).toBe("guessing");
    expect(advanced.state?.revealedCount).toBe(0); // resets for the new round

    await sendAction(hostSocket, { type: "REVEAL_NEXT_RATING" });
    const finished = await sendAction(hostSocket, { type: "SKIP_ROUND" }); // last round -> game ends
    expect(finished.ok).toBe(true);
    expect(finished.state?.status).toBe("finished");
    expect(finished.state?.winner).toBe("TIE");
  });

  it("reconnect mid-round recovers the live state — a fresh socket for the same participant sees the same phase/revealedCount/buzz/scores", async () => {
    const { host, teamA } = await setUpSessionWithGame();
    const hostSocket = connect(host.token);
    const socketAa = connect(teamA.token);
    await Promise.all([hostSocket, socketAa].map(waitForConnect));

    await sendAction(hostSocket, { type: "REVEAL_NEXT_RATING" });
    await sendAction(hostSocket, { type: "REVEAL_NEXT_RATING" });
    await sendAction(socketAa, { type: "BUZZ" });

    // A "page reload" — a brand-new socket for the exact same participant token.
    socketAa.close();
    const socketAb = connect(teamA.token);
    const resync = await waitForState(socketAb);
    expect(resync.state.phase).toBe("answering");
    expect(resync.state.buzzedTeam).toBe("TEAM_A");
    expect(resync.state.rounds[0]!.ratings.length).toBe(2);
  });
});
