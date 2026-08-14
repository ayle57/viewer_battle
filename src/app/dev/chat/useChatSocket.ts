"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { ChatChannel } from "@/domain/chat";
import type { ChatMessageWire } from "@/server/sockets/chat";

export type ConnectionStatus = "connecting" | "connected" | "disconnected" | "unauthorized";

type ChatSendResult = { ok: true; message: ChatMessageWire } | { ok: false; error: string };

/**
 * Connects to the real chat socket using a real bearer token — the
 * Socket.IO auth middleware resolves it the same way an authenticated
 * tRPC call would (see src/server/auth). Takes just the token, not a
 * full identity: who you are is now something the server tells the
 * client (via chat:history/chat:message's sender info), not a claim the
 * client makes at connect time.
 */
export function useChatSocket(token: string | null) {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [messagesByChannel, setMessagesByChannel] = useState<Partial<Record<ChatChannel, ChatMessageWire[]>>>({});
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!token) return;

    const socket = io({ path: "/socket.io", auth: { token } });
    socketRef.current = socket;

    socket.on("connect", () => setStatus("connected"));
    socket.on("disconnect", () => setStatus("disconnected"));
    socket.on("connect_error", () => setStatus("unauthorized"));

    socket.on("chat:history", ({ channel, messages }: { channel: ChatChannel; messages: ChatMessageWire[] }) => {
      setMessagesByChannel((current) => ({ ...current, [channel]: messages }));
    });

    socket.on("chat:message", (message: ChatMessageWire) => {
      setMessagesByChannel((current) => ({
        ...current,
        [message.channel]: [...(current[message.channel] ?? []), message],
      }));
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token]);

  const send = useCallback((channel: ChatChannel, body: string) => {
    return new Promise<ChatSendResult>((resolve) => {
      socketRef.current?.emit("chat:send", { channel, body }, (response: ChatSendResult) => resolve(response));
    });
  }, []);

  return { status, messagesByChannel, send };
}
