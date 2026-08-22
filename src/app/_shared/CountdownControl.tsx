"use client";

import { useState } from "react";
import { Badge, Button } from "@/ui";
import type { CountdownDurationMs } from "@/domain/game";
import { COUNTDOWN_DURATIONS_MS } from "@/domain/game";
import { formatCountdown } from "./formatCountdown";
import { useCountdownRemaining } from "./useCountdownRemaining";
import styles from "./CountdownControl.module.css";

export interface CountdownControlProps {
  deadlineMs: number | null;
  /** "End round in" (GeoGuessr) vs. "End game in" (BoardQuestion) — the idle picker's own label. */
  idleLabel: string;
  /** "Round ends in" (GeoGuessr) vs. "Game ends in" (BoardQuestion) — the running badge's own label. */
  activeLabel: string;
  onStart: (durationMs: CountdownDurationMs) => Promise<{ ok: boolean; error?: { code: string; message: string } }>;
  onCancel: () => Promise<{ ok: boolean; error?: { code: string; message: string } }>;
  /** Each engine keeps its own small error-code -> readable-text map (gameErrorMessages.ts, deliberately not shared — see that file's own doc comment), so the caller supplies the reader rather than this component picking one. */
  readError: (code: string, fallbackMessage: string) => string;
}

/**
 * The countdown-to-resolve controls — three fixed durations
 * (COUNTDOWN_DURATIONS_MS: 10s/30s/60s, the product's own set, not an
 * arbitrary picker) that schedule a real, server-governed automatic
 * resolution (src/domain/game/countdown.ts's own doc comment — what
 * "resolution" actually means is 100% up to the engine: BoardQuestion
 * ends the game outright, GeoGuessr ends the current round and
 * advances or finishes). Originally GeoGuessr's own private
 * `CountdownControl`; generalized here once BoardQuestion/Mini Jeopardy
 * needed the identical mechanic, so both Host panels share ONE
 * implementation instead of two copies quietly drifting apart. No local
 * `setTimeout` anywhere in here deciding anything —
 * `useCountdownRemaining` only re-renders a live-looking number off the
 * server's own `countdownDeadline`; the actual transition arrives as an
 * ordinary `game:state` broadcast whenever the SERVER's own timer (or
 * its checkExpiry safety net) fires, same as every other state change
 * in this app. `countdownDeadline` itself is never redacted by either
 * engine's own `toPublicView`, so this reads identically for every Host
 * tab — a stale local UI state can't drift from what's actually
 * scheduled.
 */
export function CountdownControl({ deadlineMs, idleLabel, activeLabel, onStart, onCancel, readError }: CountdownControlProps) {
  const [pending, setPending] = useState<"START" | "CANCEL" | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const remaining = useCountdownRemaining(deadlineMs);

  async function start(durationMs: CountdownDurationMs) {
    setPending("START");
    setError(null);
    const result = await onStart(durationMs);
    if (!result.ok && result.error) setError(result.error);
    setPending(null);
  }

  async function cancel() {
    setPending("CANCEL");
    setError(null);
    const result = await onCancel();
    if (!result.ok && result.error) setError(result.error);
    setPending(null);
  }

  // A running countdown replaces the picker entirely — retargeting
  // (starting a DIFFERENT duration) is still one click away via the
  // Cancel button + picker returning, deliberately not a second row of
  // buttons stacked alongside the live countdown (this régie is already
  // dense).
  if (remaining !== null) {
    return (
      <div className={styles.active}>
        <Badge variant="warning" dot>
          {activeLabel} {formatCountdown(remaining)}
        </Badge>
        {error && <span className={styles.error}>{readError(error.code, error.message)}</span>}
        <Button size="sm" variant="ghost" loading={pending === "CANCEL"} disabled={pending !== null} onClick={() => void cancel()}>
          Cancel countdown
        </Button>
      </div>
    );
  }

  return (
    <div className={styles.idle}>
      <span className={styles.label}>{idleLabel}</span>
      <div className={styles.buttons} role="group" aria-label="Start a countdown">
        {COUNTDOWN_DURATIONS_MS.map((ms) => (
          <Button key={ms} size="sm" variant="secondary" disabled={pending !== null} loading={pending === "START"} onClick={() => void start(ms)}>
            {ms / 1000}s
          </Button>
        ))}
      </div>
      {error && <span className={styles.error}>{readError(error.code, error.message)}</span>}
    </div>
  );
}
