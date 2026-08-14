import type { Server as SocketIOServer, Socket } from "socket.io";
import { canPostToChannel, channelsForRole, chatRoomName, sendChatMessageSchema } from "@/domain/chat";
import type { ChatChannel, ChatRole } from "@/domain/chat";
import { SessionError, type SessionErrorCode } from "@/domain/session";
import { resolveIdentity } from "@/server/auth";
import type { SocketIdentity } from "@/server/auth";
import { prisma } from "@/server/db/client";
import { logger } from "@/server/logger";

const HISTORY_LIMIT = 50;

export interface ChatMessageWire {
  id: string;
  channel: ChatChannel;
  role: ChatRole;
  senderName: string;
  body: string;
  createdAt: string;
}

type ChatSendAck = (response: { ok: true; message: ChatMessageWire } | { ok: false; error: string }) => void;

interface ChatMessageRow {
  id: string;
  channel: string;
  role: string;
  senderName: string;
  body: string;
  createdAt: Date;
}

function toWire(row: ChatMessageRow): ChatMessageWire {
  return {
    id: row.id,
    channel: row.channel as ChatChannel,
    role: row.role as ChatRole,
    senderName: row.senderName,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Socket.IO auth middleware: resolves the connecting socket's identity
 * (see src/server/auth) and rejects the connection if it can't. Register
 * with `io.use(chatAuthMiddleware)` before any other middleware/handlers.
 *
 * Rejections carry the same SessionError business code tRPC exposes (see
 * src/server/trpc/errors.ts) — as both the error message (so
 * `connect_error.message` alone is already useful) and `.data.code` (the
 * structured form). One resolver, one error type, two thin transport
 * translations — not two copies of the auth logic.
 */
export function chatAuthMiddleware(socket: Socket, next: (err?: Error) => void) {
  resolveIdentity(socket.handshake.auth)
    .then((identity) => {
      socket.data.identity = identity;
      next();
    })
    .catch((error: unknown) => {
      logger.warn({ socketId: socket.id, error }, "socket auth rejected");
      const code: SessionErrorCode = error instanceof SessionError ? error.code : "INVALID_TOKEN";
      const err = new Error(code) as Error & { data?: { code: SessionErrorCode } };
      err.data = { code };
      next(err);
    });
}

async function fetchHistory(sessionId: string, channel: ChatChannel): Promise<ChatMessageWire[]> {
  const rows = await prisma.chatMessage.findMany({
    where: { sessionId, channel },
    orderBy: { createdAt: "desc" },
    take: HISTORY_LIMIT,
  });
  return rows.reverse().map(toWire);
}

/**
 * Joins the socket to the rooms its role grants, sends recent history for
 * each, and registers the `chat:send` handler. Call once per connection,
 * after chatAuthMiddleware has attached `socket.data.identity`.
 */
export function registerChatHandlers(io: SocketIOServer, socket: Socket) {
  const identity = socket.data.identity as SocketIdentity;
  const rooms = channelsForRole(identity.role);

  for (const channel of rooms) {
    socket.join(chatRoomName(identity.sessionId, channel));
  }

  // Fetched fresh on every (re)connect, so a socket that reconnects after
  // a drop gets whatever it missed, not just what it saw before.
  Promise.all(rooms.map((channel) => fetchHistory(identity.sessionId, channel)))
    .then((histories) => {
      rooms.forEach((channel, index) => {
        socket.emit("chat:history", { channel, messages: histories[index] });
      });
    })
    .catch((error: unknown) => {
      logger.error({ error, socketId: socket.id }, "failed to load chat history");
    });

  socket.on("chat:send", (payload: unknown, ack?: ChatSendAck) => {
    void (async () => {
      const parsed = sendChatMessageSchema.safeParse(payload);
      if (!parsed.success) {
        ack?.({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid message" });
        return;
      }
      const { channel, body } = parsed.data;

      if (!canPostToChannel(identity.role, channel)) {
        ack?.({ ok: false, error: "You can't post to this channel" });
        return;
      }

      const created = await prisma.chatMessage.create({
        data: {
          sessionId: identity.sessionId,
          channel,
          role: identity.role,
          senderName: identity.displayName,
          body,
        },
      });

      const wire = toWire(created);
      io.to(chatRoomName(identity.sessionId, channel)).emit("chat:message", wire);
      ack?.({ ok: true, message: wire });
    })().catch((error: unknown) => {
      logger.error({ error, socketId: socket.id }, "failed to send chat message");
      ack?.({ ok: false, error: "Internal error" });
    });
  });
}
