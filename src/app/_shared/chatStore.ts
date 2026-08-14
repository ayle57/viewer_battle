"use client";

import { create } from "zustand";
import type { ChatChannel } from "@/domain/chat";
import type { ChatMessageWire } from "@/server/sockets/chat";

interface ChatState {
  messagesByChannel: Partial<Record<ChatChannel, ChatMessageWire[]>>;
  setHistory: (channel: ChatChannel, messages: ChatMessageWire[]) => void;
  appendMessage: (message: ChatMessageWire) => void;
  reset: () => void;
}

function createChatStore() {
  return create<ChatState>((set) => ({
    messagesByChannel: {},
    setHistory: (channel, messages) => set((state) => ({ messagesByChannel: { ...state.messagesByChannel, [channel]: messages } })),
    appendMessage: (message) =>
      set((state) => ({
        messagesByChannel: {
          ...state.messagesByChannel,
          [message.channel]: [...(state.messagesByChannel[message.channel] ?? []), message],
        },
      })),
    reset: () => set({ messagesByChannel: {} }),
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
