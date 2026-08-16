"use client";

import { useEffect, useMemo } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { canPostToChannel, channelsForRole, type ChatChannel } from "@/domain/chat";
import type { ParticipantRole } from "@/domain/session";
import { ChatPanel, Tabs } from "@/ui";
import { popIn } from "./motion/variants";
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
 *
 * Tabs are CONTROLLED off `chatStore`'s `activeChannel`/`unreadByChannel`
 * (not `Tabs`' own internal state) specifically so a message arriving on
 * a channel that isn't the one currently open shows a real notification
 * bubble on that tab — cleared the instant the Host/team switches to it.
 */
export function GameChatPanel({ role, displayName, sendChatMessage }: GameChatPanelProps) {
  const reduced = useReducedMotion() ?? false;
  const messagesByChannel = useChatStore((state) => state.messagesByChannel);
  const unreadByChannel = useChatStore((state) => state.unreadByChannel);
  const activeChannel = useChatStore((state) => state.activeChannel);
  const setActiveChannel = useChatStore((state) => state.setActiveChannel);
  const channels = useMemo(() => channelsForRole(role), [role]);

  // Claims the first tab as "open" the moment this panel exists, so its
  // unread badge (if any history arrived before mount) clears right
  // away instead of sitting lit with nothing focusing it. A remount
  // (e.g. the Lobby <-> GAME_IN_PROGRESS phase swap) leaves an already-
  // valid `activeChannel` alone — see chatStore.ts's own doc comment.
  useEffect(() => {
    if (activeChannel === null || !channels.includes(activeChannel)) {
      setActiveChannel(channels[0]!);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately only re-checks on a genuine channel-list change (role switching, which never happens for a live identity), not every activeChannel update this same panel just made
  }, [channels]);

  return (
    <Tabs
      value={activeChannel ?? channels[0]}
      onValueChange={(value) => setActiveChannel(value as ChatChannel)}
      items={channels.map((channel) => {
        const unread = unreadByChannel[channel] ?? 0;
        return {
          value: channel,
          label: (
            <span className={styles.tabLabel}>
              {CHANNEL_LABEL[channel]}
              <AnimatePresence initial={false}>
                {unread > 0 && (
                  <motion.span
                    key="bubble"
                    className={styles.unreadBubble}
                    aria-label={`${unread} unread message${unread === 1 ? "" : "s"}`}
                    variants={popIn(reduced, { scale: 0.4 })}
                    initial="hidden"
                    animate="show"
                    exit="hidden"
                  >
                    {unread > 99 ? "99+" : unread}
                  </motion.span>
                )}
              </AnimatePresence>
            </span>
          ),
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
        };
      })}
    />
  );
}
