"use client";

import { useEffect, useState } from "react";

/**
 * The reveal STAGE — purely cosmetic sequencing of what's already fully
 * known the instant `state.phase` becomes "revealed" (target + both
 * guesses + distances + winner all arrive together in ONE `roundResult`,
 * per src/domain/game/geoGuessr/engine.ts's doc comment). This local
 * timer only decides which of six VISUAL beats is showing — never a
 * `sendAction` call, never anything that could change gameplay — exactly
 * the same class of purely-cosmetic timer GameStartingSequence.tsx
 * already uses for its READY->3->2->1->LIVE beats, which AGENTS.md's
 * "no setTimeout deciding gameplay" rule was never about.
 *
 * "target -> Team A -> Team B -> distances -> winner" reads as a real
 * broadcast reveal building tension one piece at a time, instead of
 * dropping target+both guesses+winner on screen in the same instant
 * (flat for a moment meant to be the whole round's payoff). Each TEAM
 * stage draws that team's line alongside its own marker (not a separate
 * "lines" beat) — a line with no marker at its end reads as a stray
 * mark, not "here's how far off they were."
 *
 * Originally DisplayGeoPanel's own private hook — extracted here once
 * PlayerGeoPanel needed the identical staged reveal (a real, requested
 * UX gap: the Player's own reveal used to dump everything on screen at
 * once while Display already had this full staged treatment — "réutilise
 * les patterns existants plutôt que d'inventer un nouveau système,"
 * so this is the one shared implementation both now call, not two
 * copies drifting apart).
 */
export type RevealStage = "locked" | "reveal" | "teamA" | "teamB" | "distances" | "winner";
export const REVEAL_STAGE_ORDER: RevealStage[] = ["locked", "reveal", "teamA", "teamB", "distances", "winner"];
const STAGE_HOLD_MS: Record<RevealStage, number> = { locked: 450, reveal: 500, teamA: 550, teamB: 600, distances: 650, winner: 0 };

export function useRevealStage(active: boolean, resetKey: string, reduced: boolean): RevealStage {
  const [index, setIndex] = useState(0);
  // Render-phase reset on a genuine new round/reveal — React's own
  // blessed "adjusting state when a prop changes" pattern (two setState
  // calls in the same render branch, comparing against a STATE-tracked
  // previous value, never a ref — refs can't be read/written during
  // render). `effectiveIndex` is what THIS render actually uses, so a
  // fresh round starts its sequence from stage 0 in the same render that
  // noticed the change, rather than one render late.
  const [prevResetKey, setPrevResetKey] = useState(resetKey);
  let effectiveIndex = index;
  if (prevResetKey !== resetKey) {
    setPrevResetKey(resetKey);
    effectiveIndex = 0;
    setIndex(0);
  }

  useEffect(() => {
    if (!active || reduced) return;
    if (effectiveIndex >= REVEAL_STAGE_ORDER.length - 1) return;
    const timeout = setTimeout(() => setIndex((i) => i + 1), STAGE_HOLD_MS[REVEAL_STAGE_ORDER[effectiveIndex]!]);
    return () => clearTimeout(timeout);
  }, [active, reduced, effectiveIndex]);

  if (!active) return "locked";
  return reduced ? "winner" : REVEAL_STAGE_ORDER[effectiveIndex]!;
}
