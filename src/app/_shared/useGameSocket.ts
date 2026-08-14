"use client";

import { useCallback, useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import type { ChatChannel } from "@/domain/chat";
import type { ChatMessageWire } from "@/server/sockets/chat";
import { useGameStore, type GameError } from "./gameStore";
import { usePresenceStore, type PresenceParticipant } from "./presenceStore";
import { useChatStore } from "./chatStore";

interface GameStatePayload {
  gameId: string;
  gameKey: string;
  state: Record<string, unknown>;
  events: unknown[];
}

type GameActionResult = { ok: true; state: unknown; events: unknown[] } | { ok: false; error: GameError };
type ChatSendResult = { ok: true; message: ChatMessageWire } | { ok: false; error: string };

/**
 * Connects to the real, single, per-tab socket with a real bearer token —
 * game state, presence, AND chat all ride this one connection, because
 * the server already registers all three handlers on the same
 * io.on("connection") callback (src/server/sockets/index.ts): there's
 * only one real-time connection per identity, this hook owns it. (/dev/
 * chat's standalone useChatSocket.ts is a separate, independent tool and
 * intentionally untouched — this is NOT a replacement for it, just the
 * same event names relayed a second time for pages that already have
 * this socket open for the game.) Server-is-authoritative rule: this hook
 * never computes anything itself, it only relays what the server says
 * into the stores and forwards actions/messages.
 */
export function useGameSocket(token: string | null) {
  const setSnapshot = useGameStore((state) => state.setSnapshot);
  const setStatus = useGameStore((state) => state.setStatus);
  const setError = useGameStore((state) => state.setError);
  const setParticipants = usePresenceStore((state) => state.setParticipants);
  const setChatHistory = useChatStore((state) => state.setHistory);
  const appendChatMessage = useChatStore((state) => state.appendMessage);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!token) return;

    const socket = io({ path: "/socket.io", auth: { token } });
    socketRef.current = socket;

    socket.on("connect", () => setStatus("connected"));
    socket.on("disconnect", () => setStatus("disconnected"));
    socket.on("connect_error", () => setStatus("unauthorized"));
    socket.on("game:state", (payload: GameStatePayload) => {
      setSnapshot(payload);
      setError(null);
    });
    socket.on("presence:update", (payload: { participants: PresenceParticipant[] }) => {
      setParticipants(payload.participants);
    });
    socket.on("chat:history", ({ channel, messages }: { channel: ChatChannel; messages: ChatMessageWire[] }) => {
      setChatHistory(channel, messages);
    });
    socket.on("chat:message", (message: ChatMessageWire) => {
      appendChatMessage(message);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const sendAction = useCallback(
    (action: Record<string, unknown>) => {
      return new Promise<GameActionResult>((resolve) => {
        socketRef.current?.emit("game:action", action, (response: GameActionResult) => {
          if (!response.ok) setError(response.error);
          resolve(response);
        });
      });
    },
    [setError],
  );

  const sendChatMessage = useCallback((channel: ChatChannel, body: string) => {
    return new Promise<ChatSendResult>((resolve) => {
      socketRef.current?.emit("chat:send", { channel, body }, (response: ChatSendResult) => resolve(response));
    });
  }, []);

  return { sendAction, sendChatMessage };
}
