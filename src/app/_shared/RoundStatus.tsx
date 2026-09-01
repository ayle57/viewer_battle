"use client";

import type { ReactNode } from "react";
import styles from "./RoundStatus.module.css";

export type RoundStatusTone = "neutral" | "teamA" | "teamB";

export interface RoundStatusProps {
  children: ReactNode;
  tone?: RoundStatusTone;
}

/**
 * The one dominant "what's happening right now" line — shared by
 * HostBoardPanel/HostGeoPanel/HostDrawingPanel so a Host glancing at any
 * of the three control rooms for one second reads the same visual
 * grammar every time, not three independently-evolved treatments.
 * Consolidates what used to be three near-identical-but-drifted
 * implementations: BoardQuestion's `.bigBuzz` (2rem/1.6rem, its own team
 * color classes), GeoGuessr's `.resultHeadline` (1.3rem), and Drawing's
 * `.judgeLabel`/`.resultHeadline` (both 1.3rem-ish) — same idea, three
 * copies, three slightly different sizes. One size, one place now.
 *
 * Deliberately text-only, no animation of its own — a phase CHANGING is
 * already a real transition each panel's own `key={...}` remount +
 * `fadeUp`/`popIn` (reduced-motion-safe) handles at the call site, same
 * convention as before this pass; this component only ever renders the
 * CURRENT state, synchronously, so it has nothing to animate on its own
 * and nothing new to gate behind `prefers-reduced-motion`.
 *
 * `text-transform: uppercase` lives in the CSS, not the call sites —
 * callers pass natural, mixed-case copy (`${TEAM_LABEL[team]} is
 * drawing`), same casing TEAM_LABEL constants already use everywhere
 * else in this app; the component guarantees the visual ALL-CAPS
 * treatment uniformly instead of every call site having to remember to
 * shout in its own source string.
 */
export function RoundStatus({ children, tone = "neutral" }: RoundStatusProps) {
  return <p className={[styles.status, styles[tone]].filter(Boolean).join(" ")}>{children}</p>;
}
