"use client";

import { useMemo } from "react";
import Link from "next/link";
import { canPostToChannel, channelsForRole, type ChatChannel, type ChatRole } from "@/domain/chat";
import { Badge, ChatPanel, Tabs } from "@/ui";
import type { ChatMessageRole } from "@/ui";
import type { DevIdentity } from "../_shared/devIdentityStore";
import { RequireIdentity } from "../_shared/RequireIdentity";
import { ROLE_LABEL } from "@/app/_shared/roleLabels";
import styles from "./page.module.css";
import { useChatSocket, type ConnectionStatus } from "./useChatSocket";

const CHANNEL_LABEL: Record<ChatChannel, string> = {
  TEAM_A: "Team A",
  TEAM_B: "Team B",
  PUBLIC: "Public",
};

function toUiRole(role: ChatRole): ChatMessageRole {
  switch (role) {
    case "HOST":
      return "host";
    case "TEAM_A":
      return "team-a";
    case "TEAM_B":
      return "team-b";
    case "DISPLAY":
      return "display";
  }
}

const STATUS_BADGE: Record<ConnectionStatus, { variant: "success" | "warning" | "danger"; label: string }> = {
  connecting: { variant: "warning", label: "Connecting…" },
  connected: { variant: "success", label: "Connected" },
  disconnected: { variant: "danger", label: "Disconnected — reconnecting…" },
  unauthorized: { variant: "danger", label: "Unauthorized" },
};

export default function ChatDevPage() {
  return (
    <main className={styles.page}>
      <h1>Chat</h1>
      <p className={styles.hint}>
        Real chat vertical slice: auth, rooms, permissions, persistence, history, reconnection. Join a session in{" "}
        <Link href="/dev/session">/dev/session</Link> first, then open this page in several tabs (one identity each)
        to see it synchronize for real.
      </p>

      <RequireIdentity allow={["HOST", "TEAM_A", "TEAM_B", "DISPLAY"]}>
        {(identity) => <ChatRoom identity={identity} />}
      </RequireIdentity>
    </main>
  );
}

function ChatRoom({ identity }: { identity: DevIdentity }) {
  const { status, messagesByChannel, send } = useChatSocket(identity.token);
  const channels = useMemo(() => channelsForRole(identity.role), [identity.role]);
  const statusBadge = STATUS_BADGE[status];

  return (
    <>
      <div className={styles.statusRow}>
        <Badge variant={statusBadge.variant} dot>
          {statusBadge.label}
        </Badge>
        <Badge variant="neutral">{ROLE_LABEL[identity.role]}</Badge>
        <Badge variant="neutral">{identity.sessionCode}</Badge>
      </div>

      <Tabs
        items={channels.map((channel) => ({
          value: channel,
          label: CHANNEL_LABEL[channel],
          content: (
            <div className={styles.chatBox}>
              <ChatPanel
                messages={(messagesByChannel[channel] ?? []).map((message) => ({
                  id: message.id,
                  senderName: message.senderName,
                  role: toUiRole(message.role),
                  body: message.body,
                  createdAt: new Date(message.createdAt),
                  // Same fix, same reasoning as GameChatPanel.tsx's own
                  // `isOwn` — `role`+`senderName` alone can't tell two
                  // same-named identities apart.
                  isOwn: message.senderParticipantId !== null && message.senderParticipantId === identity.participantId,
                }))}
                disabled={!canPostToChannel(identity.role, channel)}
                onSend={(body) => void send(channel, body)}
              />
            </div>
          ),
        }))}
      />
    </>
  );
}
