"use client";

import { useEffect, useState } from "react";
import { remainingMs } from "@/domain/game";

/**
 * Purely cosmetic ticking — the exact same class of client-side timer
 * GameStartingSequence.tsx's READY->3->2->1->LIVE beats and
 * DisplayGeoPanel's own reveal-stage sequencing already use: it only
 * ever decides what NUMBER is currently rendered, never anything that
 * could change gameplay (no `sendAction` anywhere near this). The real
 * deadline this counts down to is server state (a `countdownDeadline`
 * field on whichever engine's own state — GeoGuessrState, now also
 * BoardQuestionState) — this hook just re-renders once a second so that
 * number reads as a live countdown instead of a static one; the actual
 * game-ending/round-ending transition is 100% server-driven (the
 * real-time timer in src/server/sockets/gameEndTimers.ts, or its
 * checkExpiry safety net) and arrives as an ordinary `game:state`
 * broadcast whenever it happens, same as everything else in this app.
 *
 * Shared by both games' countdown UI (originally GeoGuessr-only, moved
 * here once BoardQuestion/Mini Jeopardy got the identical feature — see
 * src/domain/game/countdown.ts's own doc comment) — engine-agnostic by
 * construction, it only ever does arithmetic on a plain epoch-ms number.
 *
 * Returns `null` when there's no deadline to count down to (the common
 * case) — callers render nothing rather than a meaningless "0:00".
 */
export function useCountdownRemaining(deadlineMs: number | null): number | null {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (deadlineMs === null) return;
    const interval = setInterval(() => setNowMs(Date.now()), 250);
    return () => clearInterval(interval);
  }, [deadlineMs]);

  if (deadlineMs === null) return null;
  return remainingMs(deadlineMs, nowMs);
}
