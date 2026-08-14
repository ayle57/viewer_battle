"use client";

import { useCallback, useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import { useGameStore, type GameError } from "./gameStore";
import { usePresenceStore, type PresenceParticipant } from "./presenceStore";

interface GameStatePayload {
  gameId: string;
  gameKey: string;
  state: Record<string, unknown>;
  events: unknown[];
}

type GameActionResult = { ok: true; state: unknown; events: unknown[] } | { ok: false; error: GameError };

/**
 * Connects to the real game socket with a real bearer token — same auth
 * seam as chat (src/app/dev/chat/useChatSocket.ts), same server-is-
 * authoritative rule: this hook never computes game state itself, it only
 * relays what `game:state` says into useGameStore and forwards actions.
 */
export function useGameSocket(token: string | null) {
  const setSnapshot = useGameStore((state) => state.setSnapshot);
  const setStatus = useGameStore((state) => state.setStatus);
  const setError = useGameStore((state) => state.setError);
  const setParticipants = usePresenceStore((state) => state.setParticipants);
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

  return { sendAction };
}
