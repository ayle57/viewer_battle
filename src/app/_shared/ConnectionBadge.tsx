import { Badge, type BadgeVariant } from "@/ui";
import type { GameConnectionStatus } from "./gameStore";

// "disconnected" reads as `warning`, not `danger` — the socket is
// actively retrying (socket.io's own reconnection, nothing this app
// drives) and every other real fact (session, roster, game state)
// stays exactly as it was; this is "hang on," not "something broke."
// `unauthorized` (a dead token, a finished session) is the one state
// here that's actually a dead end, so it's the only one that keeps
// `danger`.
const STATUS: Record<GameConnectionStatus, { variant: BadgeVariant; label: string }> = {
  connecting: { variant: "warning", label: "Connecting…" },
  connected: { variant: "success", label: "Connected" },
  disconnected: { variant: "warning", label: "Reconnecting…" },
  unauthorized: { variant: "danger", label: "Unauthorized" },
};

export function ConnectionBadge({ status }: { status: GameConnectionStatus }) {
  const { variant, label } = STATUS[status];
  return (
    <Badge variant={variant} dot size="sm">
      {label}
    </Badge>
  );
}
