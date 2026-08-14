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

  beforeAll(async () => {
    httpServer = createServer();
    createSocketServer(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const { port } = httpServer.address() as AddressInfo;
    baseUrl = `http://localhost:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await prisma.session.deleteMany({ where: { id: { in: Array.from(createdSessionIds) } } });
    await prisma.$disconnect();
  });

  async function joinAs(role: ParticipantRole, displayName: string) {
    const session = await createSession();
    createdSessionIds.add(session.id);
    const result = await joinSession({ sessionCode: session.code, role, displayName });
    return { token: result.token, sessionCode: session.code };
  }

  function connect(token: string): ClientSocket {
    return ioClient(baseUrl, {
      path: "/socket.io",
      auth: { token },
      transports: ["websocket"],
      forceNew: true,
    });
  }

  function waitForConnect(socket: ClientSocket) {
    return new Promise<void>((resolve) => socket.on("connect", () => resolve()));
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
    const teamAJoin = await joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "A1" });

    const host = connect(hostJoin.token);
    const teamA = connect(teamAJoin.token);

    const hostHistory = collectHistory(host, 3);
    const teamAHistory = collectHistory(teamA, 2);
    await Promise.all([waitForConnect(host), waitForConnect(teamA)]);

    expect(Object.keys(await hostHistory).sort()).toEqual(["PUBLIC", "TEAM_A", "TEAM_B"]);
    expect(Object.keys(await teamAHistory).sort()).toEqual(["PUBLIC", "TEAM_A"]);

    host.close();
    teamA.close();
  });

  it("broadcasts a team-A message to team A + host, but not team B", async () => {
    const session = await createSession();
    createdSessionIds.add(session.id);
    const hostJoin = await joinSession({ sessionCode: session.code, role: "HOST", displayName: "Host" });
    const teamAJoin = await joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "A1" });
    const teamBJoin = await joinSession({ sessionCode: session.code, role: "TEAM_B", displayName: "B1" });

    const host = connect(hostJoin.token);
    const teamA = connect(teamAJoin.token);
    const teamB = connect(teamBJoin.token);

    await Promise.all([waitForConnect(host), waitForConnect(teamA), waitForConnect(teamB)]);
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
