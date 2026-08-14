import type { Server as SocketIOServer, Socket } from "socket.io";
import { canPostToChannel, channelsForRole, chatRoomName, sendChatMessageSchema } from "@/domain/chat";
import type { ChatChannel, ChatRole } from "@/domain/chat";
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
 * after socketAuthMiddleware (src/server/sockets/auth.ts) has attached
 * `socket.data.identity`.
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
