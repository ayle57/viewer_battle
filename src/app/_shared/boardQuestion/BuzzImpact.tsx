"use client";

import type { ReactNode } from "react";
import { motion } from "motion/react";
import { useReducedMotionSafe } from "@/app/_shared/motion/useReducedMotionSafe";
import type { TeamRole } from "@/domain/session";
import styles from "./BuzzImpact.module.css";

export interface BuzzImpactProps {
  /** The team that just buzzed — real `state.buzzedTeam` (never null when this renders; the caller already conditions on it). Used as the `key` so a steal (buzzedTeam flips A -> B) replays the impact for real, not just a re-render. */
  team: TeamRole;
  children: ReactNode;
}

/**
 * "Someone just buzzed" as a real, brief event, not a text label that
 * silently swaps in. A team-colored flash sweeps once behind whatever
 * banner the caller renders (DisplayBoardPanel's "TEAM X IS ANSWERING",
 * PlayerBoardPanel's own buzzed state), and that content itself pops in
 * rather than appearing flat. Keying on `team` is what makes this replay
 * on a steal — React remounts the whole subtree when the key changes,
 * which is exactly "this happened again, for a different team," the
 * same real-state-keyed-remount pattern the phase transitions elsewhere
 * in this app already use (see AGENTS.md "Session vs. Game phases").
 */
export function BuzzImpact({ team, children }: BuzzImpactProps) {
  const reduced = useReducedMotionSafe(); // hydration-safe — see that hook's own doc comment
  const flashClass = team === "TEAM_A" ? styles.flashA : styles.flashB;
  const ringClass = team === "TEAM_A" ? styles.ringA : styles.ringB;

  return (
    <div className={styles.wrap} key={team}>
      <motion.span
        className={[styles.flash, flashClass].join(" ")}
        aria-hidden="true"
        initial={{ opacity: reduced ? 0 : 0.9, scaleX: reduced ? 1 : 0 }}
        animate={{ opacity: 0, scaleX: 1 }}
        transition={reduced ? { duration: 0.2 } : { duration: 0.4, ease: "easeOut" }}
      />
      {/* The "onde qui traverse le board" — a ring expanding once from
          the center and fading, on top of the sweep above. Two cheap
          transform/opacity layers read as a real impact instead of a
          single flat fade. */}
      {!reduced && (
        <motion.span
          className={[styles.ring, ringClass].join(" ")}
          aria-hidden="true"
          initial={{ opacity: 0.6, scale: 0.4 }}
          animate={{ opacity: 0, scale: 1.6 }}
          transition={{ duration: 0.55, ease: "easeOut" }}
        />
      )}
      <motion.div
        initial={reduced ? undefined : { opacity: 0, scale: 0.82 }}
        animate={reduced ? undefined : { opacity: 1, scale: 1 }}
        transition={reduced ? { duration: 0.15 } : { type: "spring", stiffness: 420, damping: 16, delay: 0.04 }}
      >
        {children}
      </motion.div>
    </div>
  );
}
