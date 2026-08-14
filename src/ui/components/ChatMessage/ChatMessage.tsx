import { Badge, type BadgeVariant } from "../../primitives/Badge/Badge";
import styles from "./ChatMessage.module.css";

/**
 * UI-level chat role — a display concern only (which badge/color to use).
 * Deliberately not the same type as the domain `ChatRole` so this
 * component stays reusable outside the chat feature; callers map their
 * own role type onto this one.
 */
export type ChatMessageRole = "host" | "team-a" | "team-b" | "display";

export interface ChatMessageData {
  id: string;
  senderName: string;
  role: ChatMessageRole;
  body: string;
  createdAt: Date;
}

const ROLE_BADGE: Record<ChatMessageRole, { variant: BadgeVariant; label: string }> = {
  host: { variant: "host", label: "Host" },
  "team-a": { variant: "teamA", label: "Team A" },
  "team-b": { variant: "teamB", label: "Team B" },
  display: { variant: "display", label: "Display" },
};

/**
 * Deliberately not `toLocaleTimeString` / `Intl.DateTimeFormat` here:
 * those resolve the runtime's default locale, which differs between the
 * Node server (SSR render) and the browser (hydration) — 24h "13:30" vs
 * 12h "01:30 PM" — and React flags that as a hydration mismatch. A fixed
 * 24h HH:MM format has no locale to disagree on.
 */
function formatTime(date: Date): string {
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

export function ChatMessage({ senderName, role, body, createdAt }: ChatMessageData) {
  const badge = ROLE_BADGE[role];

  return (
    <div className={styles.message}>
      <div className={styles.metaRow}>
        <span className={styles.sender}>{senderName}</span>
        <Badge variant={badge.variant}>{badge.label}</Badge>
        <span className={styles.time}>{formatTime(createdAt)}</span>
      </div>
      <p className={styles.body}>{body}</p>
    </div>
  );
}
