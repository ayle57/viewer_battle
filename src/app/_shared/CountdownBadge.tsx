"use client";

import { Badge } from "@/ui";
import { formatCountdown } from "./formatCountdown";
import { useCountdownRemaining } from "./useCountdownRemaining";
import styles from "./CountdownBadge.module.css";

export interface CountdownBadgeProps {
  deadlineMs: number | null;
  /** What's actually ending — "Round ends in" (GeoGuessr, most of the time) vs. "Game ends in" (BoardQuestion, always; GeoGuessr's own last round) — see each caller's own doc comment for which applies. Defaults to a neutral phrasing that's honest either way. */
  label?: string;
  /** Passed straight through to the underlying `<span>` — Display's own OBS-scale treatment is a font-size bump via its own CSS module, not a Badge-level size variant (Badge only has sm/md — see its own type). */
  className?: string;
}

/** Under this, the countdown reads as genuinely urgent, not just "counting down" — a real, audited gap: 10 seconds and 2 minutes left used to be visually identical. */
const CRITICAL_MS = 10_000;

/**
 * The read-only half of the countdown feature — shared by every
 * non-Host role of every engine that opts in (originally GeoGuessr-only;
 * generalized once BoardQuestion/Mini Jeopardy got the identical
 * mechanic — see src/domain/game/countdown.ts's own doc comment). Host
 * has its own richer `CountdownControl` (START/CANCEL buttons included,
 * since only HOST can ever trigger this — each engine's own
 * FORBIDDEN_ROLE check backs that up server-side regardless of what any
 * client renders). Renders nothing at all when there's no active
 * countdown (`deadlineMs === null`), the overwhelming common case.
 * `countdownDeadline` is never redacted by either engine's own
 * `toPublicView` — every role sees the exact same number, so this reads
 * identically for a Player, the other Player, and Display all at once.
 */
export function CountdownBadge({ deadlineMs, label = "Ends in", className }: CountdownBadgeProps) {
  const remaining = useCountdownRemaining(deadlineMs);
  if (remaining === null) return null;
  const critical = remaining <= CRITICAL_MS;
  return (
    <Badge variant={critical ? "danger" : "warning"} dot className={[className, critical && styles.critical].filter(Boolean).join(" ")}>
      {label} {formatCountdown(remaining)}
    </Badge>
  );
}
