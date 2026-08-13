import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { createSocketServer } from "@/server/sockets";

const TOKEN = "test-token";

describe("Socket.IO server (Phase 0 spike)", () => {
  let baseUrl: string;
  let httpServer: ReturnType<typeof createServer>;

  beforeAll(async () => {
    httpServer = createServer();
    createSocketServer(httpServer, { expectedToken: TOKEN });
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const { port } = httpServer.address() as AddressInfo;
    baseUrl = `http://localhost:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  function connect(token: string): ClientSocket {
    return ioClient(baseUrl, {
      path: "/socket.io",
      auth: { token },
      transports: ["websocket"],
      forceNew: true,
    });
  }

  it("rejects a connection with an invalid token", async () => {
    const client = connect("wrong-token");
    const error = await new Promise<Error>((resolve) => {
      client.on("connect_error", resolve);
    });
    expect(error.message).toBe("unauthorized");
    client.close();
  });

  it("accepts a connection with a valid token", async () => {
    const client = connect(TOKEN);
    await new Promise<void>((resolve) => client.on("connect", resolve));
    expect(client.connected).toBe(true);
    client.close();
  });

  it("broadcasts an event to every client in a room, and only that room", async () => {
    const room = "room-a";
    const clientA = connect(TOKEN);
    const clientB = connect(TOKEN);
    const clientOutside = connect(TOKEN); // never joins the room

    await Promise.all([
      new Promise<void>((resolve) => clientA.on("connect", resolve)),
      new Promise<void>((resolve) => clientB.on("connect", resolve)),
      new Promise<void>((resolve) => clientOutside.on("connect", resolve)),
    ]);

    await Promise.all([
      new Promise<void>((resolve) => clientA.emit("spike:join-room", room, () => resolve())),
      new Promise<void>((resolve) => clientB.emit("spike:join-room", room, () => resolve())),
    ]);

    const receivedByA: unknown[] = [];
    const receivedByB: unknown[] = [];
    const receivedByOutside: unknown[] = [];
    clientA.on("spike:pong", (payload) => receivedByA.push(payload));
    clientB.on("spike:pong", (payload) => receivedByB.push(payload));
    clientOutside.on("spike:pong", (payload) => receivedByOutside.push(payload));

    clientA.emit("spike:ping", { room, message: "hello" });

    // give the broadcast a moment to land on both room members
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(receivedByA).toHaveLength(1);
    expect(receivedByB).toHaveLength(1);
    expect(receivedByOutside).toHaveLength(0);
    expect(receivedByB[0]).toMatchObject({ message: "hello" });

    clientA.close();
    clientB.close();
    clientOutside.close();
  });
});
