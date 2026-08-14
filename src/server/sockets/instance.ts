import type { Server as SocketIOServer } from "socket.io";

/**
 * A shared reference to the one Socket.IO server instance, set once by
 * createSocketServer (src/server/sockets/index.ts) when the custom server
 * boots. Exists so that code OUTSIDE the socket connection lifecycle —
 * specifically the tRPC `game.start` mutation, which runs in the same
 * Node process but isn't itself a socket handler — can still broadcast
 * (e.g. "a game just started") to already-connected clients. Socket
 * handlers themselves get `io` passed directly and don't need this.
 *
 * Stashed on `globalThis`, same reasoning as src/server/db/client.ts's
 * Prisma singleton: `src/app/api/trpc/[trpc]/route.ts` (under src/app,
 * hot-reloaded by Next's own Fast Refresh) and src/server/server.ts (its
 * own module graph, restarted whole by tsx watch on change — see
 * AGENTS.md) can end up as genuinely different module instances of this
 * same file after a dev-mode edit. A plain module-level `let` would give
 * each its own copy — the tRPC side would read a variable that was never
 * set, silently skipping the broadcast. `globalThis` is the one thing
 * that's actually shared across those instances within a single process,
 * in dev exactly where this bites (production has no HMR to cause it,
 * but the fix costs nothing there either).
 */
const globalForSocketServer = globalThis as unknown as { ioInstance?: SocketIOServer };

export function setSocketServer(io: SocketIOServer): void {
  globalForSocketServer.ioInstance = io;
}

export function getSocketServer(): SocketIOServer | null {
  return globalForSocketServer.ioInstance ?? null;
}
