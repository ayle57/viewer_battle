"use client";

import { useCallback, useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import type { ChatChannel } from "@/domain/chat";
import type { ChatMessageWire } from "@/server/sockets/chat";
import { useGameStore, type GameError } from "./gameStore";
import { usePresenceStore, type PresenceParticipant } from "./presenceStore";
import { useChatStore } from "./chatStore";
import { useIdentityStore } from "./identityStore";
import { useDrawingStore, type DrawingStroke } from "./drawingStore";

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
  const setSessionEnded = useGameStore((state) => state.setSessionEnded);
  const setKicked = useGameStore((state) => state.setKicked);
  const setSynced = useGameStore((state) => state.setSynced);
  const resetGameStore = useGameStore((state) => state.reset);
  const setParticipants = usePresenceStore((state) => state.setParticipants);
  const setChatHistory = useChatStore((state) => state.setHistory);
  const appendChatMessage = useChatStore((state) => state.appendMessage);
  const updateSessionCode = useIdentityStore((state) => state.updateSessionCode);
  const addDrawingStroke = useDrawingStore((state) => state.addStroke);
  const clearDrawingStrokes = useDrawingStore((state) => state.clear);
  const undoLastDrawingStroke = useDrawingStore((state) => state.undoLast);
  const resetDrawingStore = useDrawingStore((state) => state.reset);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!token) return;

    // A new `token` means a genuinely new connection lifecycle — a fresh
    // identity, possibly a fresh session entirely (see gameStore.ts's
    // own doc comment on `reset()` for the real bug this closes: a stale
    // `sessionEnded: true` from a PREVIOUS, actually-ended session was
    // silently surviving this exact transition and pinning every new
    // session right back to the same terminal screen). Reset before
    // opening the socket, so nothing here ever renders a single stale
    // frame of the old identity's state under the new one.
    resetGameStore();
    resetDrawingStore(); // same fresh-identity reasoning as resetGameStore — a new token/session shouldn't carry over a stale canvas from whatever the previous identity was drawing/watching

    const socket = io({ path: "/socket.io", auth: { token } });
    socketRef.current = socket;

    socket.on("connect", () => setStatus("connected"));
    socket.on("disconnect", () => setStatus("disconnected"));
    // A REAL, REPRODUCED bug this closes (found via an actual offline
    // Chromium context, not a code read): `connect_error` fires for
    // EVERY failed connection attempt, not only a genuine auth
    // rejection — socket.io's own automatic reconnection loop retries
    // the handshake while the network is still down, and each failed
    // retry is ALSO a `connect_error`, indistinguishable from a real
    // rejected token unless something narrows it. Only
    // socketAuthMiddleware's OWN rejections (src/server/sockets/auth.ts)
    // carry `error.data.code` (the same `SessionErrorCode` convention
    // tRPC errors use — see readableSessionError's identical check) — a
    // plain transport failure never has it. Without this narrowing, a
    // player/display who just lost wifi jumped straight to `unauthorized`
    // (StatusBanner's danger-toned "CONNECTION LOST"/"DISPLAY OFFLINE",
    // a real dead end) within seconds of going offline, when the true,
    // self-healing "disconnected" state was the honest description —
    // confirmed directly: an offline Chromium context never showed the
    // `disconnected` banner at all, only ever `unauthorized`.
    socket.on("connect_error", (error: Error & { data?: { code?: string } }) => {
      setStatus(error.data?.code ? "unauthorized" : "disconnected");
    });
    socket.on("game:state", (payload: GameStatePayload) => {
      setSnapshot(payload);
      setError(null);
    });
    // See gameStore.ts's `synced` doc comment: always fires once per
    // connection, whether or not a game exists — the one signal that
    // tells "haven't heard from the server yet" (gameId still null,
    // reads exactly like SESSION_LOBBY) apart from "confirmed: no game."
    socket.on("game:synced", () => setSynced());
    socket.on("presence:update", (payload: { participants: PresenceParticipant[] }) => {
      setParticipants(payload.participants);
    });
    socket.on("chat:history", ({ channel, messages }: { channel: ChatChannel; messages: ChatMessageWire[] }) => {
      setChatHistory(channel, messages);
    });
    socket.on("chat:message", (message: ChatMessageWire) => {
      appendChatMessage(message);
    });
    socket.on("session:ended", () => setSessionEnded());
    socket.on("participant:kicked", () => setKicked());
    // A REAL, REPRODUCED bug this closes — see identityStore.ts's own
    // doc comment on `updateSessionCode`: without this, rotating the
    // session code (self-service, or automatically as part of a kick)
    // left every OTHER already-connected client's `session.getState`
    // polling using a now-stale code, 404ing forever and misread as the
    // whole session having ended.
    socket.on("session:code-rotated", ({ code }: { code: string }) => updateSessionCode(code));
    // Drawing's own ephemeral channel (src/server/sockets/drawing.ts) —
    // rides this SAME socket/connection, same "one real-time connection
    // per identity" posture as everything else in this hook, never a
    // second `io()` call. `drawing:stroke`/`drawing:clear` are the only
    // two events genuinely PUSHED unprompted (the live view a teammate/
    // host sees as the drawer draws); the snapshot/prompt pulls below are
    // request/response, not subscriptions.
    socket.on("drawing:stroke", (stroke: DrawingStroke) => addDrawingStroke(stroke));
    socket.on("drawing:clear", () => clearDrawingStrokes());
    socket.on("drawing:undo", () => undoLastDrawingStroke());

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

  // Drawing's ephemeral, non-kernel actions — see drawing.ts's own doc
  // comment: the server re-validates authorization live against the
  // Kernel's own current state on every single call here, never trusts
  // that a client only calls `sendStroke` while it's genuinely the
  // drawer (a UI gate on top, but never the real boundary).
  const sendStroke = useCallback((stroke: DrawingStroke) => {
    return new Promise<{ ok: boolean; error?: string }>((resolve) => {
      socketRef.current?.emit("drawing:stroke", stroke, resolve);
    });
  }, []);

  const sendDrawingClear = useCallback(() => {
    return new Promise<{ ok: boolean; error?: string }>((resolve) => {
      socketRef.current?.emit("drawing:clear", {}, resolve);
    });
  }, []);

  const sendDrawingUndo = useCallback(() => {
    return new Promise<{ ok: boolean; error?: string }>((resolve) => {
      socketRef.current?.emit("drawing:undo", {}, resolve);
    });
  }, []);

  /** Pull, not subscribe — see drawing.ts's own doc comment on why this is the reconnect story: call it whenever a panel newly cares (mount, or the moment `phase` stops being "drawing"), and it always answers with what's true right now. */
  const requestDrawingSnapshot = useCallback(() => {
    return new Promise<{ strokes: DrawingStroke[] }>((resolve) => {
      socketRef.current?.emit("drawing:request-snapshot", {}, resolve);
    });
  }, []);

  /** The ONLY path the secret word ever reaches this client on — see drawing.ts's own top comment. Safe to call speculatively; the server answers `{ text: null }` unless this socket's own identity genuinely matches the Kernel's current drawer. */
  const requestDrawingPrompt = useCallback(() => {
    return new Promise<{ text: string | null }>((resolve) => {
      socketRef.current?.emit("drawing:request-prompt", {}, resolve);
    });
  }, []);

  return { sendAction, sendChatMessage, sendStroke, sendDrawingClear, sendDrawingUndo, requestDrawingSnapshot, requestDrawingPrompt };
}
