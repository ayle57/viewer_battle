"use client";

import { useMemo, useState } from "react";
import { canPostToChannel, channelsForRole, type ChatChannel, type ChatRole } from "@/domain/chat";
import { Badge, Button, Card, CardBody, CardHeader, ChatPanel, Input, Tabs } from "@/ui";
import type { ChatMessageRole } from "@/ui";
import styles from "./page.module.css";
import { useChatSocket, type ChatIdentityInput, type ConnectionStatus } from "./useChatSocket";

const CHANNEL_LABEL: Record<ChatChannel, string> = {
  TEAM_A: "Team A",
  TEAM_B: "Team B",
  PUBLIC: "Public",
};

const ROLE_LABEL: Record<ChatRole, string> = {
  HOST: "Host",
  TEAM_A: "Team A",
  TEAM_B: "Team B",
  DISPLAY: "Display",
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
  const [identity, setIdentity] = useState<ChatIdentityInput | null>(null);
  const [sessionCode, setSessionCode] = useState("dev-session");
  const [role, setRole] = useState<ChatRole>("HOST");
  const [displayName, setDisplayName] = useState("");

  function handleJoin() {
    if (!displayName.trim()) return;
    setIdentity({ sessionCode: sessionCode.trim() || "dev-session", role, displayName: displayName.trim() });
  }

  if (!identity) {
    return (
      <main className={styles.page}>
        <h1>Chat — dev harness</h1>
        <p className={styles.hint}>
          Testing tool for the real chat vertical slice. Open this page in several tabs with different roles to see
          rooms/permissions/broadcast/history/reconnection for real.
          <br />
          This join form is a temporary stand-in for real Host/Player/Display auth (see AGENTS.md) — it lets you
          pick a role directly, which the real system never will.
        </p>
        <Card>
          <CardHeader title="Join a session" />
          <CardBody>
            <div className={styles.form}>
              <Input
                label="Session code"
                value={sessionCode}
                onChange={(event) => setSessionCode(event.target.value)}
              />
              <div className={styles.selectField}>
                <label className={styles.selectLabel} htmlFor="role">
                  Role
                </label>
                <select
                  id="role"
                  className={styles.select}
                  value={role}
                  onChange={(event) => setRole(event.target.value as ChatRole)}
                >
                  {(Object.keys(ROLE_LABEL) as ChatRole[]).map((value) => (
                    <option key={value} value={value}>
                      {ROLE_LABEL[value]}
                    </option>
                  ))}
                </select>
              </div>
              <Input
                label="Display name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="e.g. Jamie"
              />
              <Button onClick={handleJoin} disabled={!displayName.trim()}>
                Join
              </Button>
            </div>
          </CardBody>
        </Card>
      </main>
    );
  }

  return (
    <ChatRoom
      key={`${identity.sessionCode}:${identity.role}:${identity.displayName}`}
      identity={identity}
      onLeave={() => setIdentity(null)}
    />
  );
}

/**
 * Remounted (via the `key` above) every time the join form produces a new
 * identity, so `useChatSocket`'s own state starts fresh — no manual
 * "reset to connecting" needed inside its effect.
 */
function ChatRoom({ identity, onLeave }: { identity: ChatIdentityInput; onLeave: () => void }) {
  const { status, messagesByChannel, send } = useChatSocket(identity);
  const channels = useMemo(() => channelsForRole(identity.role), [identity.role]);
  const statusBadge = STATUS_BADGE[status];

  return (
    <main className={styles.page}>
      <div className={styles.statusRow}>
        <h1>Chat — {identity.sessionCode}</h1>
        <Badge variant={statusBadge.variant} dot>
          {statusBadge.label}
        </Badge>
        <Badge variant="neutral">{ROLE_LABEL[identity.role]}</Badge>
        <Button size="sm" variant="ghost" onClick={onLeave}>
          Leave
        </Button>
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
                }))}
                disabled={!canPostToChannel(identity.role, channel)}
                onSend={(body) => void send(channel, body)}
              />
            </div>
          ),
        }))}
      />
    </main>
  );
}
