import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { createSocketServer } from "@/server/sockets";
import { prisma } from "@/server/db/client";
import type { ChatMessageWire } from "@/server/sockets/chat";

/**
 * Real end-to-end coverage of the chat vertical slice: the same
 * createSocketServer used by src/server/server.ts, a real Postgres via
 * Prisma, actual Socket.IO clients. This is the "replace, don't just
 * delete" successor to the Phase 0 spike's socket/prisma tests — same
 * shape (auth middleware, room-scoped broadcast, DB round-trip), now
 * exercised through real chat behavior instead of spike:* events.
 */
describe("Chat vertical slice (Socket.IO auth + rooms + permissions + Prisma)", () => {
  let baseUrl: string;
  let httpServer: ReturnType<typeof createServer>;
  const createdSessionCodes = new Set<string>();

  beforeAll(async () => {
    httpServer = createServer();
    createSocketServer(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const { port } = httpServer.address() as AddressInfo;
    baseUrl = `http://localhost:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await prisma.session.deleteMany({ where: { code: { in: Array.from(createdSessionCodes) } } });
    await prisma.$disconnect();
  });

  function sessionCode(label: string) {
    const code = `test-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    createdSessionCodes.add(code);
    return code;
  }

  function connect(auth: Record<string, unknown>): ClientSocket {
    return ioClient(baseUrl, {
      path: "/socket.io",
      auth,
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

  it("rejects a connection with an invalid handshake payload", async () => {
    const client = connect({ sessionCode: "x", role: "NOT_A_ROLE", displayName: "Bob" });
    const error = await waitForConnectError(client);
    expect(error.message).toBe("unauthorized");
    client.close();
  });

  it("accepts a valid handshake and auto-creates the session", async () => {
    const code = sessionCode("accept");
    const client = connect({ sessionCode: code, role: "HOST", displayName: "Host Alex" });
    await waitForConnect(client);
    expect(client.connected).toBe(true);

    const session = await prisma.session.findUnique({ where: { code } });
    expect(session).not.toBeNull();

    client.close();
  });

  it("host joins all 3 channels; team A joins only its own + public", async () => {
    const code = sessionCode("rooms");
    const host = connect({ sessionCode: code, role: "HOST", displayName: "Host" });
    const teamA = connect({ sessionCode: code, role: "TEAM_A", displayName: "A1" });

    const hostHistory = collectHistory(host, 3);
    const teamAHistory = collectHistory(teamA, 2);
    await Promise.all([waitForConnect(host), waitForConnect(teamA)]);

    expect(Object.keys(await hostHistory).sort()).toEqual(["PUBLIC", "TEAM_A", "TEAM_B"]);
    expect(Object.keys(await teamAHistory).sort()).toEqual(["PUBLIC", "TEAM_A"]);

    host.close();
    teamA.close();
  });

  it("broadcasts a team-A message to team A + host, but not team B", async () => {
    const code = sessionCode("broadcast");
    const host = connect({ sessionCode: code, role: "HOST", displayName: "Host" });
    const teamA = connect({ sessionCode: code, role: "TEAM_A", displayName: "A1" });
    const teamB = connect({ sessionCode: code, role: "TEAM_B", displayName: "B1" });

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
    const code = sessionCode("perm-a-to-b");
    const teamA = connect({ sessionCode: code, role: "TEAM_A", displayName: "A1" });
    await waitForConnect(teamA);

    const ack = await send(teamA, "TEAM_B", "sneaky");
    expect(ack.ok).toBe(false);

    teamA.close();
  });

  it("rejects the display role trying to send any message", async () => {
    const code = sessionCode("perm-display");
    const display = connect({ sessionCode: code, role: "DISPLAY", displayName: "OBS" });
    await waitForConnect(display);

    const ack = await send(display, "PUBLIC", "I should not be able to do this");
    expect(ack.ok).toBe(false);

    display.close();
  });

  it("persists sent messages to Postgres", async () => {
    const code = sessionCode("persist");
    const host = connect({ sessionCode: code, role: "HOST", displayName: "Host" });
    await waitForConnect(host);

    const ack = await send(host, "PUBLIC", "persisted message");
    expect(ack.ok).toBe(true);

    const session = await prisma.session.findUniqueOrThrow({ where: { code } });
    const rows = await prisma.chatMessage.findMany({ where: { sessionId: session.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.body).toBe("persisted message");

    host.close();
  });

  it("sends full history to a fresh connection, covering messages sent before it joined", async () => {
    const code = sessionCode("history");
    const host = connect({ sessionCode: code, role: "HOST", displayName: "Host" });
    await waitForConnect(host);
    await send(host, "PUBLIC", "first message");
    host.close();

    const rejoined = connect({ sessionCode: code, role: "HOST", displayName: "Host" });
    const history = await collectHistory(rejoined, 3);
    expect(history.PUBLIC?.map((m) => m.body)).toContain("first message");

    rejoined.close();
  });
});
