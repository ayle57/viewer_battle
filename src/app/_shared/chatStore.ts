"use client";

import { create } from "zustand";
import type { ChatChannel } from "@/domain/chat";
import type { ChatMessageWire } from "@/server/sockets/chat";

interface ChatState {
  messagesByChannel: Partial<Record<ChatChannel, ChatMessageWire[]>>;
  /** Unread count per channel — "unread" means arrived via a live `chat:message` while that channel wasn't the one currently open in this tab's own GameChatPanel, never the initial history backlog (see `setHistory`). Cleared the instant `setActiveChannel` opens that tab. */
  unreadByChannel: Partial<Record<ChatChannel, number>>;
  /** Whichever channel THIS tab's GameChatPanel currently has open — `null` before it's ever mounted. Lives here, not as local component state, so it survives a GameChatPanel remount (e.g. the Lobby <-> GAME_IN_PROGRESS phase swap re-renders a different JSX subtree — see host/page.tsx) instead of resetting to the first tab every time. */
  activeChannel: ChatChannel | null;
  setHistory: (channel: ChatChannel, messages: ChatMessageWire[]) => void;
  appendMessage: (message: ChatMessageWire) => void;
  setActiveChannel: (channel: ChatChannel) => void;
  reset: () => void;
}

function createChatStore() {
  return create<ChatState>((set) => ({
    messagesByChannel: {},
    unreadByChannel: {},
    activeChannel: null,
    setHistory: (channel, messages) => set((state) => ({ messagesByChannel: { ...state.messagesByChannel, [channel]: messages } })),
    appendMessage: (message) =>
      set((state) => {
        const messagesByChannel = {
          ...state.messagesByChannel,
          [message.channel]: [...(state.messagesByChannel[message.channel] ?? []), message],
        };
        // The channel currently open in this tab doesn't accrue an
        // unread badge for a message landing right in front of the
        // reader — including their own message echoed back (they can
        // only ever send to whichever channel's composer is visible,
        // which is by definition the active one), so no separate
        // "is this my own message" check is needed here.
        if (message.channel === state.activeChannel) {
          return { messagesByChannel };
        }
        return {
          messagesByChannel,
          unreadByChannel: { ...state.unreadByChannel, [message.channel]: (state.unreadByChannel[message.channel] ?? 0) + 1 },
        };
      }),
    setActiveChannel: (channel) =>
      set((state) => ({ activeChannel: channel, unreadByChannel: { ...state.unreadByChannel, [channel]: 0 } })),
    reset: () => set({ messagesByChannel: {}, unreadByChannel: {}, activeChannel: null }),
  }));
}

/**
 * Chat history for the tab's one real-time connection (useGameSocket.ts
 * now also relays chat:history/chat:message on that same socket — see
 * its comment for why this isn't a second useChatSocket-style
 * connection). Pinned to globalThis, same reasoning as gameStore.ts's
 * useGameStore: a Fast Refresh re-execution of this module must not hand
 * out a second store while the live socket keeps writing to the old one.
 */
const globalForChatStore = globalThis as unknown as { viewerBattleChatStore?: ReturnType<typeof createChatStore> };
export const useChatStore =
  globalForChatStore.viewerBattleChatStore ?? (globalForChatStore.viewerBattleChatStore = createChatStore());
