import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { createSocketServer } from "@/server/sockets";
import { broadcastGameSnapshot } from "@/server/sockets/game";
import { createSession } from "@/server/db/session";
import { joinSession } from "@/server/db/participant";
import { startGame } from "@/server/game";
import { sampleMusicPlaylist } from "@/domain/game/music";
import { prisma } from "@/server/db/client";

interface MusicSnapshot {
  gameId: string;
  gameKey: string;
  state: {
    status: string;
    phase: string;
    currentRoundIndex: number;
    playbackStartedAt: number | null;
    playbackPausedAt: number | null;
    broadcastVolume: number;
    buzzedTeam: string | null;
    submittedAnswer: string | null;
    attemptedTeams: string[];
    scores: { TEAM_A: number; TEAM_B: number };
    winner: string | null;
    rounds: { id: string; audioUrl: string; title: string | null; artist: string | null }[];
  };
  events: { type: string }[];
}

/**
 * Full vertical slice, real Socket.IO transport, for Music ("Guess the
 * Music") — the counterpart to geoguessr-socket.test.ts, focused on
 * what's genuinely new here: the mandatory shared first play
 * (`playbackStartedAt`, server-injected — a client can't fake when
 * playback "really" started), and the buzzer-race/steal mechanic over a
 * real per-role redacted broadcast. Unlike Drawing, Music has NO
 * ephemeral socket layer of its own — every action here rides the exact
 * same generic `game:action`/`game:state` path GeoGuessr/BoardQuestion
 * already use (src/server/sockets/game.ts), so this file never touches
 * that file itself. No other game's own socket test file is touched.
 */
describe("Music vertical slice (Socket.IO: mandatory shared first play, buzz/steal, reveal)", () => {
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

    const started = await startGame(session.id, "music", sampleMusicPlaylist);
    if (!started.ok) throw new Error("setup failed to start game");
    broadcastGameSnapshot(io, session.id, started.gameId, started.gameKey, started.state, started.events);

    return { sessionId: session.id, host, teamA, teamB, display };
  }

  /** Attached synchronously, right after `connect()` — see geoguessr-socket.test.ts's identical `waitForState` doc comment for why timing here matters. */
  function waitForState(socket: ClientSocket): Promise<MusicSnapshot> {
    return new Promise((resolve) => socket.once("game:state", resolve));
  }

  function waitForStateWhere(socket: ClientSocket, predicate: (snapshot: MusicSnapshot) => boolean): Promise<MusicSnapshot> {
    return new Promise((resolve) => {
      function handler(snapshot: MusicSnapshot) {
        if (!predicate(snapshot)) return;
        socket.off("game:state", handler);
        resolve(snapshot);
      }
      socket.on("game:state", handler);
    });
  }

  function sendAction(socket: ClientSocket, action: Record<string, unknown>) {
    return new Promise<{ ok: boolean; error?: { code: string; message: string }; state?: MusicSnapshot["state"] }>((resolve) => {
      socket.emit("game:action", action, resolve);
    });
  }

  it("a freshly connecting socket receives the current snapshot, current round's audio blanked pre-play (still 'intro')", async () => {
    const { host, teamA } = await setUpSessionWithGame();
    const hostSocket = connect(host.token);
    const hostState = waitForState(hostSocket);
    const teamASocket = connect(teamA.token);
    const teamAState = waitForState(teamASocket);

    const hostSnapshot = await hostState;
    expect(hostSnapshot.state.phase).toBe("intro");
    expect(hostSnapshot.state.rounds[0]!.title).toBe(sampleMusicPlaylist.rounds[0]!.title); // HOST sees the real answer

    const teamASnapshot = await teamAState;
    expect(teamASnapshot.state.rounds[0]!.audioUrl).toBe(""); // not even the clip yet — the mandatory shared play hasn't happened
    expect(teamASnapshot.state.rounds[0]!.title).toBeNull();
  });

  it("only the HOST may START_PLAYBACK; `nowMs` is server-injected, never taken from the client", async () => {
    const { host, teamA } = await setUpSessionWithGame();
    const hostSocket = connect(host.token);
    const socketA = connect(teamA.token);
    await Promise.all([hostSocket, socketA].map(waitForConnect));

    const rejected = await sendAction(socketA, { type: "START_PLAYBACK" });
    expect(rejected.ok).toBe(false);
    expect(rejected.error?.code).toBe("FORBIDDEN_ROLE");

    const before = Date.now();
    // A client can send whatever `nowMs` it wants — the server overwrites
    // it (src/server/sockets/game.ts's own action-spreading comment).
    const started = await sendAction(hostSocket, { type: "START_PLAYBACK", nowMs: 1 });
    const after = Date.now();
    expect(started.ok).toBe(true);
    expect(started.state?.phase).toBe("guessing");
    expect(started.state?.playbackStartedAt).toBeGreaterThanOrEqual(before);
    expect(started.state?.playbackStartedAt).toBeLessThanOrEqual(after);
  });

  it("BUZZ is rejected before the mandatory first play; the audio (but not the answer) becomes visible to every role once it happens", async () => {
    const { host, teamA, display } = await setUpSessionWithGame();
    const hostSocket = connect(host.token);
    const socketA = connect(teamA.token);
    const displaySocket = connect(display.token);
    await Promise.all([hostSocket, socketA, displaySocket].map(waitForConnect));

    const tooEarly = await sendAction(socketA, { type: "BUZZ" });
    expect(tooEarly.ok).toBe(false);
    expect(tooEarly.error?.code).toBe("WRONG_PHASE");

    const teamABroadcast = waitForStateWhere(socketA, (s) => s.state.phase === "guessing");
    const displayBroadcast = waitForStateWhere(displaySocket, (s) => s.state.phase === "guessing");
    await sendAction(hostSocket, { type: "START_PLAYBACK" });

    const teamASnapshot = await teamABroadcast;
    expect(teamASnapshot.state.rounds[0]!.audioUrl).toBe(sampleMusicPlaylist.rounds[0]!.audioUrl);
    expect(teamASnapshot.state.rounds[0]!.title).toBeNull(); // still the answer, still hidden

    const displaySnapshot = await displayBroadcast;
    expect(displaySnapshot.state.rounds[0]!.audioUrl).toBe(sampleMusicPlaylist.rounds[0]!.audioUrl);

    const buzz = await sendAction(socketA, { type: "BUZZ" });
    expect(buzz.ok).toBe(true);
    expect(buzz.state?.buzzedTeam).toBe("TEAM_A");
  });

  it("a correct judgment reveals the real title/artist to Display and awards the point; DISPLAY can never act", async () => {
    const { host, teamA, display } = await setUpSessionWithGame();
    const hostSocket = connect(host.token);
    const socketA = connect(teamA.token);
    const displaySocket = connect(display.token);
    await Promise.all([hostSocket, socketA, displaySocket].map(waitForConnect));

    const displayGetsRevealed = waitForStateWhere(displaySocket, (s) => s.state.phase === "revealed");

    await sendAction(hostSocket, { type: "START_PLAYBACK" });
    const buzzRejectedForDisplay = await sendAction(displaySocket, { type: "BUZZ" });
    expect(buzzRejectedForDisplay.ok).toBe(false);
    expect(buzzRejectedForDisplay.error?.code).toBe("FORBIDDEN_ROLE");

    await sendAction(socketA, { type: "BUZZ" });
    await sendAction(socketA, { type: "SUBMIT_ANSWER", text: sampleMusicPlaylist.rounds[0]!.title });
    const judged = await sendAction(hostSocket, { type: "JUDGE_ANSWER", correct: true });
    expect(judged.ok).toBe(true);
    expect(judged.state?.phase).toBe("revealed");
    expect(judged.state?.scores).toEqual({ TEAM_A: 1, TEAM_B: 0 });

    const displaySnapshot = await displayGetsRevealed;
    expect(displaySnapshot.state.rounds[0]!.title).toBe(sampleMusicPlaylist.rounds[0]!.title);
    expect(displaySnapshot.state.rounds[0]!.artist).toBe(sampleMusicPlaylist.rounds[0]!.artist ?? null);
  });

  it("a wrong answer opens a real steal to the other team over separate sockets — a successful steal awards TEAM_B", async () => {
    const { host, teamA, teamB } = await setUpSessionWithGame();
    const hostSocket = connect(host.token);
    const socketA = connect(teamA.token);
    const socketB = connect(teamB.token);
    await Promise.all([hostSocket, socketA, socketB].map(waitForConnect));

    await sendAction(hostSocket, { type: "START_PLAYBACK" });
    await sendAction(socketA, { type: "BUZZ" });
    await sendAction(socketA, { type: "SUBMIT_ANSWER", text: "totally wrong" });
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
    await sendAction(socketB, { type: "SUBMIT_ANSWER", text: sampleMusicPlaylist.rounds[0]!.title });
    const stealJudged = await sendAction(hostSocket, { type: "JUDGE_ANSWER", correct: true });
    expect(stealJudged.ok).toBe(true);
    expect(stealJudged.state?.scores).toEqual({ TEAM_A: 0, TEAM_B: 1 });
  });

  it("REPLAY_AUDIO re-anchors playbackStartedAt for everyone, in sync, without touching phase/buzz state", async () => {
    const { host, teamA } = await setUpSessionWithGame();
    const hostSocket = connect(host.token);
    const socketA = connect(teamA.token);
    await Promise.all([hostSocket, socketA].map(waitForConnect));

    const started = await sendAction(hostSocket, { type: "START_PLAYBACK" });
    const firstAnchor = started.state?.playbackStartedAt as number;

    const teamASeesReplay = waitForStateWhere(socketA, (s) => (s.state.playbackStartedAt ?? 0) > firstAnchor);
    await new Promise((resolve) => setTimeout(resolve, 5)); // ensure a genuinely later timestamp
    const replayed = await sendAction(hostSocket, { type: "REPLAY_AUDIO" });
    expect(replayed.ok).toBe(true);
    expect(replayed.state?.playbackStartedAt).toBeGreaterThan(firstAnchor);
    expect(replayed.state?.phase).toBe("guessing");

    const teamASnapshot = await teamASeesReplay;
    expect(teamASnapshot.state.playbackStartedAt).toBe(replayed.state?.playbackStartedAt);
  });

  it("PAUSE_PLAYBACK/RESUME_PLAYBACK are HOST-only and reach Display in real time; a non-host is rejected", async () => {
    const { host, teamA, display } = await setUpSessionWithGame();
    const hostSocket = connect(host.token);
    const socketA = connect(teamA.token);
    const displaySocket = connect(display.token);
    await Promise.all([hostSocket, socketA, displaySocket].map(waitForConnect));

    await sendAction(hostSocket, { type: "START_PLAYBACK" });

    const rejected = await sendAction(socketA, { type: "PAUSE_PLAYBACK" });
    expect(rejected.ok).toBe(false);
    expect(rejected.error?.code).toBe("FORBIDDEN_ROLE");

    const displaySeesPause = waitForStateWhere(displaySocket, (s) => s.state.playbackPausedAt !== null);
    const paused = await sendAction(hostSocket, { type: "PAUSE_PLAYBACK" });
    expect(paused.ok).toBe(true);
    expect(typeof paused.state?.playbackPausedAt).toBe("number");
    const displayPaused = await displaySeesPause;
    expect(displayPaused.state.playbackPausedAt).toBe(paused.state?.playbackPausedAt);

    const rejectedResume = await sendAction(socketA, { type: "RESUME_PLAYBACK" });
    expect(rejectedResume.ok).toBe(false);
    expect(rejectedResume.error?.code).toBe("FORBIDDEN_ROLE");

    const displaySeesResume = waitForStateWhere(displaySocket, (s) => s.state.playbackPausedAt === null);
    const resumed = await sendAction(hostSocket, { type: "RESUME_PLAYBACK" });
    expect(resumed.ok).toBe(true);
    expect(resumed.state?.playbackPausedAt).toBeNull();
    const displayResumed = await displaySeesResume;
    expect(displayResumed.state.playbackStartedAt).toBe(resumed.state?.playbackStartedAt);
  });

  it("SET_VOLUME is HOST-only, legal even during 'intro', reaches Display in real time, and survives NEXT_ROUND", async () => {
    const { host, teamA, display } = await setUpSessionWithGame();
    const hostSocket = connect(host.token);
    const socketA = connect(teamA.token);
    const displaySocket = connect(display.token);
    await Promise.all([hostSocket, socketA, displaySocket].map(waitForConnect));

    // Still "intro" — no START_PLAYBACK yet.
    const rejected = await sendAction(socketA, { type: "SET_VOLUME", volume: 0.5 });
    expect(rejected.ok).toBe(false);
    expect(rejected.error?.code).toBe("FORBIDDEN_ROLE");

    const displaySeesVolume = waitForStateWhere(displaySocket, (s) => s.state.broadcastVolume === 0.4);
    const set = await sendAction(hostSocket, { type: "SET_VOLUME", volume: 0.4 });
    expect(set.ok).toBe(true);
    expect(set.state?.broadcastVolume).toBe(0.4);
    expect(set.state?.phase).toBe("intro"); // untouched — SET_VOLUME never advances the round

    const displaySnapshot = await displaySeesVolume;
    expect(displaySnapshot.state.broadcastVolume).toBe(0.4);

    const outOfRange = await sendAction(hostSocket, { type: "SET_VOLUME", volume: 1.2 });
    expect(outOfRange.ok).toBe(false);

    // Persists through the round's real lifecycle.
    await sendAction(hostSocket, { type: "START_PLAYBACK" });
    const skipped = await sendAction(hostSocket, { type: "SKIP_ROUND" });
    expect(skipped.state?.broadcastVolume).toBe(0.4);
    const advanced = await sendAction(hostSocket, { type: "NEXT_ROUND" });
    expect(advanced.state?.broadcastVolume).toBe(0.4);
  });

  it("SKIP_ROUND then NEXT_ROUND advances with no score change; running out of the sample's 2 rounds ends the game in a TIE", async () => {
    const { host } = await setUpSessionWithGame();
    const hostSocket = connect(host.token);
    await waitForConnect(hostSocket);

    await sendAction(hostSocket, { type: "START_PLAYBACK" });
    const skipped = await sendAction(hostSocket, { type: "SKIP_ROUND" });
    expect(skipped.ok).toBe(true);
    expect(skipped.state?.phase).toBe("revealed");
    expect(skipped.state?.scores).toEqual({ TEAM_A: 0, TEAM_B: 0 });

    const advanced = await sendAction(hostSocket, { type: "NEXT_ROUND" });
    expect(advanced.ok).toBe(true);
    expect(advanced.state?.currentRoundIndex).toBe(1);
    expect(advanced.state?.phase).toBe("intro");

    await sendAction(hostSocket, { type: "START_PLAYBACK" });
    const finished = await sendAction(hostSocket, { type: "SKIP_ROUND" }); // last round -> game ends
    expect(finished.ok).toBe(true);
    expect(finished.state?.status).toBe("finished");
    expect(finished.state?.winner).toBe("TIE");
  });

  it("reconnect mid-round recovers the live state — a fresh socket for the same participant sees the same phase/buzz/scores", async () => {
    const { host, teamA } = await setUpSessionWithGame();
    const hostSocket = connect(host.token);
    const socketAa = connect(teamA.token);
    await Promise.all([hostSocket, socketAa].map(waitForConnect));

    await sendAction(hostSocket, { type: "START_PLAYBACK" });
    await sendAction(socketAa, { type: "BUZZ" });

    // A "page reload" — a brand-new socket for the exact same participant token.
    socketAa.close();
    const socketAb = connect(teamA.token);
    const resync = await waitForState(socketAb);
    expect(resync.state.phase).toBe("answering");
    expect(resync.state.buzzedTeam).toBe("TEAM_A");
  });
});
