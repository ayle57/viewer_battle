"use client";

import { useState } from "react";
import type { SessionPhase } from "./sessionPhase";

/**
 * The READY->3->2->1->LIVE trigger — shared verbatim by player/page.tsx
 * and display/page.tsx (Host is different: it sets `sequenceActive`
 * itself, off its own Start Game click, never off a witnessed `phase`
 * transition — see host/page.tsx). Both Player and Display never click
 * Start; they only ever find out a game began by `phase` changing
 * underneath them (the `game:state` broadcast landing), so this fires off
 * a real witnessed SESSION_LOBBY/GAME_FINISHED -> GAME_IN_PROGRESS
 * transition, not a guess.
 *
 * A REAL, REPRODUCED bug this closes ("dès que tu recharges la page" —
 * the countdown replaying on every reload/reconnect mid-game, not just a
 * genuine fresh start): the naive version of this (`prevPhase` seeded
 * from `useState(phase)` at mount) assumed a fresh mount's FIRST `phase`
 * reading was already trustworthy. It isn't — `gameId` (gameStore.ts)
 * starts `null` until the server's catch-up snapshot actually arrives (a
 * real async DB read, strictly AFTER the socket transport itself
 * connects), so `phase` reads as SESSION_LOBBY for a real, if brief,
 * window on every single mount/reload, even mid-game. The very next
 * render (once the catch-up lands) then looks EXACTLY like a genuine
 * "the game just started" transition, and replays the intro over the
 * real board every time.
 *
 * The fix: don't trust ANY phase reading as a baseline until `synced`
 * (gameStore.ts — fires once per connection, whether or not a game
 * exists, unlike `gameId`/`phase` which can't tell "haven't heard yet"
 * apart from "confirmed: no game") says the catch-up has genuinely
 * completed. The first `phase` seen once `synced` flips true is adopted
 * SILENTLY as the baseline — even if it's already GAME_IN_PROGRESS, a
 * reconnect mid-game must never replay the intro — and only phase
 * changes witnessed AFTER that count as real transitions.
 */
export function useGameStartingSequence(phase: SessionPhase, synced: boolean) {
  const [hasSynced, setHasSynced] = useState(false);
  const [prevPhase, setPrevPhase] = useState(phase);
  const [sequenceActive, setSequenceActive] = useState(false);

  if (synced && !hasSynced) {
    setHasSynced(true);
    if (prevPhase !== phase) setPrevPhase(phase);
  } else if (hasSynced && prevPhase !== phase) {
    if (phase === "GAME_IN_PROGRESS" && prevPhase !== "GAME_IN_PROGRESS") setSequenceActive(true);
    setPrevPhase(phase);
  }

  return { sequenceActive, setSequenceActive };
}
