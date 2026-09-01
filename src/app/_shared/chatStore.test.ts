import { beforeEach, describe, expect, it } from "vitest";
import { useChatStore } from "./chatStore";
import type { ChatMessageWire } from "@/server/sockets/chat";

/**
 * The unread-notification bookkeeping (chatStore.ts's `unreadByChannel`/
 * `activeChannel`) — pure store logic, tested directly via
 * `useChatStore.getState()`/`.setState()` (zustand hands out the
 * underlying vanilla store alongside the React hook), no component/DOM
 * needed. Reset before each test since the store is a real singleton
 * (pinned to globalThis — see the file's own doc comment).
 */
describe("chatStore — unread notifications", () => {
  beforeEach(() => {
    useChatStore.getState().reset();
  });

  function message(overrides: Partial<ChatMessageWire> = {}): ChatMessageWire {
    return {
      id: overrides.id ?? Math.random().toString(36),
      channel: overrides.channel ?? "TEAM_A",
      role: overrides.role ?? "TEAM_A",
      senderName: overrides.senderName ?? "Alice",
      senderParticipantId: overrides.senderParticipantId ?? "participant-alice",
      body: overrides.body ?? "hi",
      createdAt: overrides.createdAt ?? new Date().toISOString(),
    };
  }

  it("starts with no unread and no active channel", () => {
    const state = useChatStore.getState();
    expect(state.unreadByChannel).toEqual({});
    expect(state.activeChannel).toBeNull();
  });

  it("a message on a channel that isn't active bumps its unread count", () => {
    useChatStore.getState().setActiveChannel("PUBLIC");
    useChatStore.getState().appendMessage(message({ channel: "TEAM_A" }));
    expect(useChatStore.getState().unreadByChannel.TEAM_A).toBe(1);
    useChatStore.getState().appendMessage(message({ channel: "TEAM_A" }));
    expect(useChatStore.getState().unreadByChannel.TEAM_A).toBe(2);
  });

  it("a message on the currently active channel never bumps its own unread count", () => {
    useChatStore.getState().setActiveChannel("TEAM_A");
    useChatStore.getState().appendMessage(message({ channel: "TEAM_A" }));
    expect(useChatStore.getState().unreadByChannel.TEAM_A ?? 0).toBe(0);
  });

  it("switching to a channel clears its unread count without touching others", () => {
    useChatStore.getState().setActiveChannel("PUBLIC");
    useChatStore.getState().appendMessage(message({ channel: "TEAM_A" }));
    useChatStore.getState().appendMessage(message({ channel: "TEAM_B" }));
    expect(useChatStore.getState().unreadByChannel).toEqual({ PUBLIC: 0, TEAM_A: 1, TEAM_B: 1 });

    useChatStore.getState().setActiveChannel("TEAM_A");
    expect(useChatStore.getState().unreadByChannel.TEAM_A).toBe(0);
    expect(useChatStore.getState().unreadByChannel.TEAM_B).toBe(1); // untouched
    expect(useChatStore.getState().activeChannel).toBe("TEAM_A");
  });

  it("loading history (setHistory) never counts as unread — only live appendMessage does", () => {
    useChatStore.getState().setActiveChannel("PUBLIC");
    useChatStore.getState().setHistory("TEAM_A", [message({ channel: "TEAM_A" }), message({ channel: "TEAM_A" })]);
    expect(useChatStore.getState().unreadByChannel.TEAM_A ?? 0).toBe(0);
    expect(useChatStore.getState().messagesByChannel.TEAM_A).toHaveLength(2);
  });

  it("reset clears messages, unread counts, and the active channel", () => {
    useChatStore.getState().setActiveChannel("PUBLIC");
    useChatStore.getState().appendMessage(message({ channel: "TEAM_A" }));
    useChatStore.getState().reset();
    const state = useChatStore.getState();
    expect(state.messagesByChannel).toEqual({});
    expect(state.unreadByChannel).toEqual({});
    expect(state.activeChannel).toBeNull();
  });
});
