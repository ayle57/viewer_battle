"use client";

import { useMemo } from "react";
import { canPostToChannel, channelsForRole, type ChatChannel } from "@/domain/chat";
import type { ParticipantRole } from "@/domain/session";
import { ChatPanel, Tabs } from "@/ui";
import { useChatStore } from "./chatStore";
import { toChatMessageRole } from "./roleLabels";
import styles from "./GameChatPanel.module.css";

const CHANNEL_LABEL: Record<ChatChannel, string> = {
  TEAM_A: "Team A",
  TEAM_B: "Team B",
  PUBLIC: "Public",
};

export interface GameChatPanelProps {
  role: ParticipantRole;
  /** This tab's own display name — used only to right-align/bubble-tint its own messages back to it; the server is still the one deciding who posted what. */
  displayName: string;
  sendChatMessage: (channel: ChatChannel, body: string) => void;
}

/**
 * The chat feed for whichever channels `role` actually belongs to
 * (src/domain/chat/permissions.ts — HOST gets all three, a team gets its
 * own + PUBLIC, DISPLAY gets PUBLIC read-only), rendered off the tab's
 * one real-time connection (see useGameSocket.ts's comment on why chat
 * rides the same socket as game state here) instead of a second one.
 * Shared by /dev/host, /dev/player, /dev/display so none of them
 * duplicate this wiring — same rendering /dev/chat's own page already
 * uses, just fed by the shared socket instead of its own.
 */
export function GameChatPanel({ role, displayName, sendChatMessage }: GameChatPanelProps) {
  const messagesByChannel = useChatStore((state) => state.messagesByChannel);
  const channels = useMemo(() => channelsForRole(role), [role]);

  return (
    <Tabs
      items={channels.map((channel) => ({
        value: channel,
        label: CHANNEL_LABEL[channel],
        content: (
          <div className={styles.box}>
            <ChatPanel
              messages={(messagesByChannel[channel] ?? []).map((message) => ({
                id: message.id,
                senderName: message.senderName,
                role: toChatMessageRole(message.role),
                body: message.body,
                createdAt: new Date(message.createdAt),
                isOwn: message.role === role && message.senderName === displayName,
              }))}
              disabled={!canPostToChannel(role, channel)}
              onSend={(body) => sendChatMessage(channel, body)}
            />
          </div>
        ),
      }))}
    />
  );
}
