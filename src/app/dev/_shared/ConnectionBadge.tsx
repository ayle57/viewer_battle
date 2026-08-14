import { Badge, type BadgeVariant } from "@/ui";
import type { GameConnectionStatus } from "./gameStore";

const STATUS: Record<GameConnectionStatus, { variant: BadgeVariant; label: string }> = {
  connecting: { variant: "warning", label: "Connecting…" },
  connected: { variant: "success", label: "Connected" },
  disconnected: { variant: "danger", label: "Reconnecting…" },
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
