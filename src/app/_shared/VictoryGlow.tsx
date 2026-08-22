"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { useReducedMotionSafe } from "@/app/_shared/motion/useReducedMotionSafe";
import { EASE_OUT_EXPO } from "@/app/_shared/motion/variants";
import type { TeamRole } from "@/domain/session";
import styles from "./VictoryGlow.module.css";

/**
 * The "the winner takes over the screen" background wash. Used to be
 * three separate copies of the same recipe — WinnerReveal.module.css's
 * `.glow`, DisplayGeoPanel.module.css's `.winnerGlow*`, PlayerGeoPanel.
 * module.css's `.winnerGlow*` (each one's own doc comment explicitly
 * pointed at the others as "same recipe" because CSS Modules can't share
 * a class across files) — each `position: absolute` inside its own small
 * headline-sized wrapper. A REAL, REPORTED bug/complaint this closes:
 * "les effets de background... coupées pas correctement" — the glow was
 * never actually broken, it was just clipped down to a few dozen pixels
 * around whatever text it sat behind, nowhere near the "wahou, prend tout
 * l'écran" moment a live entertainment show wants for a win.
 *
 * Portaled to `document.body` (same technique as ActionsMenu.tsx) so
 * `position: fixed; inset: 0` always means the REAL viewport, completely
 * independent of whichever small Card/panel happens to render the win —
 * one implementation, reused by all three callers, instead of three
 * copies quietly drifting apart. `pointer-events: none` throughout, so it
 * never competes with a click/tap anywhere on screen.
 */
export function VictoryGlow({ team }: { team: TeamRole }) {
  const reduced = useReducedMotionSafe(); // hydration-safe — see that hook's own doc comment
  const [mounted, setMounted] = useState(false);
  // Portals need a real `document` — never available during SSR/the first
  // render. Same one-time "external system" read this app already has a
  // convention for (lastDisplayName.ts, useReducedMotionSafe).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);
  if (!mounted) return null;

  return createPortal(
    <motion.div
      className={[styles.glow, team === "TEAM_A" ? styles.teamA : styles.teamB].join(" ")}
      aria-hidden="true"
      initial={{ clipPath: "circle(0% at 50% 50%)" }}
      animate={{ clipPath: "circle(80% at 50% 50%)" }}
      transition={reduced ? { duration: 0.15 } : { duration: 0.9, ease: EASE_OUT_EXPO }}
    />,
    document.body,
  );
}
