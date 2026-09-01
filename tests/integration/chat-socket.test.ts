import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { createSocketServer } from "@/server/sockets";
import { createSession } from "@/server/db/session";
import { joinSession } from "@/server/db/participant";
import type { ParticipantRole } from "@/domain/session";
import { prisma } from "@/server/db/client";
import type { ChatMessageWire } from "@/server/sockets/chat";

/**
 * Real end-to-end coverage of the chat vertical slice: the same
 * createSocketServer used by src/server/server.ts, real sessions/tokens
 * via createSession + joinSession (the exact functions the tRPC session
 * router calls), a real Postgres via Prisma, actual Socket.IO clients.
 */
describe("Chat vertical slice (Socket.IO auth + rooms + permissions + Prisma)", () => {
  let baseUrl: string;
  let httpServer: ReturnType<typeof createServer>;
  const createdSessionIds = new Set<string>();
  const openSockets: ClientSocket[] = [];

  beforeAll(async () => {
    httpServer = createServer();
    createSocketServer(httpServer);
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
    const socket = ioClient(baseUrl, {
      path: "/socket.io",
      auth: { token },
      transports: ["websocket"],
      forceNew: true,
    });
    openSockets.push(socket);
    return socket;
  }

  function waitForConnect(socket: ClientSocket) {
    return new Promise<void>((resolve) => socket.on("connect", () => resolve()));
  }

  /**
   * joinSession now requires a genuinely connected host for any non-host
   * role (src/server/db/participant.ts's HOST_NOT_CONNECTED gate) — a
   * session code was never supposed to be enough on its own. The
   * listener has to be attached in the same tick the socket is created,
   * or "presence:update" can already have fired with nothing subscribed
   * yet (see the identical comment in session.test.ts).
   */
  function connectAndWaitForPresence(token: string): { socket: ClientSocket; ready: Promise<void> } {
    const socket = connect(token);
    const ready = new Promise<void>((resolve) => socket.once("presence:update", () => resolve()));
    return { socket, ready };
  }

  /** A fresh session with a real, genuinely connected host — what any non-host role now needs to exist before it can join. The host socket is left open (not returned) so it doesn't get closed out from under later joins; afterAll cleans it up like every other socket this file opens. */
  async function sessionWithConnectedHost() {
    const session = await createSession();
    createdSessionIds.add(session.id);
    const hostJoin = await joinSession({ sessionCode: session.code, role: "HOST", displayName: "Host" });
    const { ready } = connectAndWaitForPresence(hostJoin.token);
    await ready;
    return { sessionCode: session.code, hostToken: hostJoin.token };
  }

  /** Joins a fresh session as `role`. For HOST, that's just the session's own host (nothing to connect first — HOST is exempt from the presence gate). For anyone else, a real host is created and connected first, same as any real client would need. */
  async function joinAs(role: ParticipantRole, displayName: string) {
    if (role === "HOST") {
      const session = await createSession();
      createdSessionIds.add(session.id);
      const result = await joinSession({ sessionCode: session.code, role: "HOST", displayName });
      return { token: result.token, sessionCode: session.code };
    }
    const { sessionCode } = await sessionWithConnectedHost();
    const result = await joinSession({ sessionCode, role, displayName });
    return { token: result.token, sessionCode };
  }

  function waitForConnectError(socket: ClientSocket) {
    return new Promise<Error>((resolve) => socket.on("connect_error", resolve));
  }

  function collectHistory(socket: ClientSocket, expectedChannelCount: number) {
    return new Promise<Record<string, ChatMessageWire[]>>((resolve) => {
      const byChannel: Record<string, ChatMessageWire[]> = {};
      let seen = 0;
      socket.on("chat:history", ({ channel, messages }: { channel: string; messages: ChatMessageWire[] }) => {
        byChannel[channel] = messages;
        seen += 1;
        if (seen === expectedChannelCount) resolve(byChannel);
      });
    });
  }

  function send(socket: ClientSocket, channel: string, body: string) {
    return new Promise<{ ok: boolean; error?: string; message?: ChatMessageWire }>((resolve) => {
      socket.emit("chat:send", { channel, body }, resolve);
    });
  }

  it("rejects a connection with an invalid token", async () => {
    const client = connect("not-a-real-token");
    const error = await waitForConnectError(client);
    expect(error.message).toBe("INVALID_TOKEN");
    client.close();
  });

  it("accepts a connection with a real token", async () => {
    const { token } = await joinAs("HOST", "Host Alex");
    const client = connect(token);
    await waitForConnect(client);
    expect(client.connected).toBe(true);
    client.close();
  });

  it("host joins all 3 channels; team A joins only its own + public", async () => {
    const session = await createSession();
    createdSessionIds.add(session.id);
    const hostJoin = await joinSession({ sessionCode: session.code, role: "HOST", displayName: "Host" });
    const { socket: host, ready: hostReady } = connectAndWaitForPresence(hostJoin.token);
    // collectHistory's listener must be attached before awaiting
    // anything — chat:history for all 3 channels arrives right alongside
    // presence:update, and a `.once`/handler subscribed too late misses
    // events that already fired.
    const hostHistory = collectHistory(host, 3);
    await hostReady;
    const teamAJoin = await joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "A1" });

    const teamA = connect(teamAJoin.token);
    const teamAHistory = collectHistory(teamA, 2);
    await waitForConnect(teamA);

    expect(Object.keys(await hostHistory).sort()).toEqual(["PUBLIC", "TEAM_A", "TEAM_B"]);
    expect(Object.keys(await teamAHistory).sort()).toEqual(["PUBLIC", "TEAM_A"]);

    host.close();
    teamA.close();
  });

  it("broadcasts a team-A message to team A + host, but not team B", async () => {
    const session = await createSession();
    createdSessionIds.add(session.id);
    const hostJoin = await joinSession({ sessionCode: session.code, role: "HOST", displayName: "Host" });
    const { socket: host, ready: hostReady } = connectAndWaitForPresence(hostJoin.token);
    await hostReady;
    const teamAJoin = await joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "A1" });
    const teamBJoin = await joinSession({ sessionCode: session.code, role: "TEAM_B", displayName: "B1" });

    const teamA = connect(teamAJoin.token);
    const teamB = connect(teamBJoin.token);

    // host is already connected (connectAndWaitForPresence, above) —
    // waiting for its "connect" event again here would hang forever.
    await Promise.all([waitForConnect(teamA), waitForConnect(teamB)]);
    await new Promise((resolve) => setTimeout(resolve, 100)); // let initial history settle

    const hostReceived: ChatMessageWire[] = [];
    const teamBReceived: ChatMessageWire[] = [];
    host.on("chat:message", (m: ChatMessageWire) => hostReceived.push(m));
    teamB.on("chat:message", (m: ChatMessageWire) => teamBReceived.push(m));

    const ack = await send(teamA, "TEAM_A", "hello team");
    expect(ack.ok).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(hostReceived).toHaveLength(1);
    expect(hostReceived[0]?.body).toBe("hello team");
    expect(teamBReceived).toHaveLength(0);

    host.close();
    teamA.close();
    teamB.close();
  });

  /**
   * A REAL, REPRODUCED bug ("les equipes c'est nimp la Chat"): the
   * client used to decide "is this MY OWN message" off `role`+
   * `senderName` alone (GameChatPanel.tsx) — two teammates who happen to
   * share a display name were indistinguishable by that pair, so every
   * message from EITHER one showed up tagged "You" on the OTHER's own
   * screen too. This locks down the server-side half of the fix: two
   * SEPARATE participants with the IDENTICAL role+displayName still get
   * distinct `senderParticipantId`s on the wire, matching each one's own
   * `joinSession` id exactly — the one thing the client's `isOwn` check
   * now actually compares.
   */
  it("two teammates sharing a display name still get distinguishable senderParticipantId on their messages", async () => {
    const { sessionCode } = await sessionWithConnectedHost();
    const dup1 = await joinSession({ sessionCode, role: "TEAM_A", displayName: "Dup" });
    // The first seat must be genuinely CONNECTED before the second join —
    // joinSession's own reclaim-by-name path (src/server/db/participant.ts)
    // only skips reusing a same-name/same-role seat once a LIVE presence
    // check (isParticipantConnected) proves someone's actually still
    // there; two back-to-back `joinSession` calls with nobody connected
    // yet would otherwise reclaim the SAME seat instead of creating a
    // real second one, which isn't the bug this test exists to guard.
    const socket1 = connect(dup1.token);
    await waitForConnect(socket1);

    const dup2 = await joinSession({ sessionCode, role: "TEAM_A", displayName: "Dup" });
    expect(dup1.id).not.toBe(dup2.id); // two genuinely separate seats, not a reused one

    const socket2 = connect(dup2.token);
    await waitForConnect(socket2);

    const ack1 = await send(socket1, "TEAM_A", "from seat 1");
    const ack2 = await send(socket2, "TEAM_A", "from seat 2");
    expect(ack1.ok).toBe(true);
    expect(ack2.ok).toBe(true);

    expect(ack1.message?.senderParticipantId).toBe(dup1.id);
    expect(ack2.message?.senderParticipantId).toBe(dup2.id);
    expect(ack1.message?.senderParticipantId).not.toBe(ack2.message?.senderParticipantId);
    // Exactly what the old bug compared, both identical on purpose — this
    // is the pair that used to be (wrongly) treated as "close enough."
    expect(ack1.message?.role).toBe(ack2.message?.role);
    expect(ack1.message?.senderName).toBe(ack2.message?.senderName);

    socket1.close();
    socket2.close();
  });

  it("rejects team A posting into team B's channel", async () => {
    const { token } = await joinAs("TEAM_A", "A1");
    const teamA = connect(token);
    await waitForConnect(teamA);

    const ack = await send(teamA, "TEAM_B", "sneaky");
    expect(ack.ok).toBe(false);

    teamA.close();
  });

  it("rejects the display role trying to send any message", async () => {
    const { token } = await joinAs("DISPLAY", "OBS");
    const display = connect(token);
    await waitForConnect(display);

    const ack = await send(display, "PUBLIC", "I should not be able to do this");
    expect(ack.ok).toBe(false);

    display.close();
  });

  it("blocks a player message that trips the word filter, but not the same word from the Host", async () => {
    const { prisma: db } = await import("@/server/db/client");
    const { invalidateBlockedWordCache } = await import("@/server/db/blockedWords");
    await db.blockedWord.upsert({ where: { word: "zzblockedzz" }, create: { word: "zzblockedzz" }, update: {} });
    invalidateBlockedWordCache();

    const { token: aToken } = await joinAs("TEAM_A", "A1");
    const { token: hToken } = await joinAs("HOST", "Host");
    const teamA = connect(aToken);
    const host = connect(hToken);
    await Promise.all([waitForConnect(teamA), waitForConnect(host)]);

    const blocked = await send(teamA, "TEAM_A", "you zzblockedzz idiot");
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toMatch(/blocked/i);

    // evasion (spacing) is caught too
    const evaded = await send(teamA, "TEAM_A", "z z b l o c k e d z z");
    expect(evaded.ok).toBe(false);

    // a clean message from the same player still goes through
    const clean = await send(teamA, "TEAM_A", "gg everyone");
    expect(clean.ok).toBe(true);

    // the Host is never filtered
    const hostSaysIt = await send(host, "TEAM_A", "reminder: the word zzblockedzz is filtered for players");
    expect(hostSaysIt.ok).toBe(true);

    await db.blockedWord.deleteMany({ where: { word: "zzblockedzz" } });
    invalidateBlockedWordCache();
    teamA.close();
    host.close();
  });

  it("persists sent messages to Postgres", async () => {
    const { token, sessionCode } = await joinAs("HOST", "Host");
    const host = connect(token);
    await waitForConnect(host);

    const ack = await send(host, "PUBLIC", "persisted message");
    expect(ack.ok).toBe(true);

    const session = await prisma.session.findUniqueOrThrow({ where: { code: sessionCode } });
    const rows = await prisma.chatMessage.findMany({ where: { sessionId: session.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.body).toBe("persisted message");

    host.close();
  });

  it("sends full history to a fresh connection, covering messages sent before it joined", async () => {
    const { token } = await joinAs("HOST", "Host");
    const host = connect(token);
    await waitForConnect(host);
    await send(host, "PUBLIC", "first message");
    host.close();

    const rejoined = connect(token);
    const history = await collectHistory(rejoined, 3);
    expect(history.PUBLIC?.map((m) => m.body)).toContain("first message");

    rejoined.close();
  });

  it("rejects a token whose session has finished", async () => {
    const session = await createSession();
    createdSessionIds.add(session.id);
    const hostJoin = await joinSession({ sessionCode: session.code, role: "HOST", displayName: "Host" });
    await prisma.session.update({ where: { id: session.id }, data: { status: "FINISHED" } });

    const client = connect(hostJoin.token);
    const error = await waitForConnectError(client);
    expect(error.message).toBe("SESSION_CLOSED");
    client.close();
  });
});
