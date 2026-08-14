"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { ChatChannel, ChatRole } from "@/domain/chat";
import type { ChatMessageWire } from "@/server/sockets/chat";

export type ConnectionStatus = "connecting" | "connected" | "disconnected" | "unauthorized";

/**
 * Shape the dev/chat join form collects and hands to the socket handshake.
 * This is the ONE place that couples to the dev-only auth stand-in
 * (src/server/auth/devIdentity.ts) — swapping in real Host/Player/Display
 * tokens later means changing this input + what gets passed as `auth`
 * below, nothing in the chat UI components or the socket handler code.
 */
export interface ChatIdentityInput {
  sessionCode: string;
  role: ChatRole;
  displayName: string;
}

type ChatSendResult = { ok: true; message: ChatMessageWire } | { ok: false; error: string };

export function useChatSocket(identity: ChatIdentityInput | null) {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [messagesByChannel, setMessagesByChannel] = useState<Partial<Record<ChatChannel, ChatMessageWire[]>>>({});
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!identity) return;

    // No manual "reset to connecting" here on purpose: this hook's caller
    // remounts (via a React `key`) on identity change, so initial state
    // already starts fresh — see ChatRoom in page.tsx.
    const socket = io({ path: "/socket.io", auth: identity });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity?.sessionCode, identity?.role, identity?.displayName]);

  const send = useCallback((channel: ChatChannel, body: string) => {
    return new Promise<ChatSendResult>((resolve) => {
      socketRef.current?.emit("chat:send", { channel, body }, (response: ChatSendResult) => resolve(response));
    });
  }, []);

  return { status, messagesByChannel, send };
}
