"use client";

import { AnimatePresence, motion } from "motion/react";
import { useReducedMotionSafe } from "@/app/_shared/motion/useReducedMotionSafe";
import styles from "./SaveStatus.module.css";

export type SaveState = "idle" | "saving" | "saved" | "error";

const LABEL: Record<Exclude<SaveState, "idle">, string> = {
  saving: "Saving…",
  saved: "Saved",
  error: "Couldn't save",
};

/**
 * The one save-status indicator, used everywhere Content Studio has an
 * explicit-save field (playlist name/description, the Question Editor) —
 * same "● dot + label" visual language as PresenceDot/Badge's `dot`
 * variant (src/ui/components/PresenceDot, src/ui/primitives/Badge) rather
 * than a new motif, and deliberately quiet: no toast, just a small label
 * that cross-fades between states in place. `idle` renders nothing — this
 * only ever appears once a save has actually been attempted.
 */
export function SaveStatus({ state, className }: { state: SaveState; className?: string }) {
  const reduced = useReducedMotionSafe(); // hydration-safe — see that hook's own doc comment

  return (
    <span className={[styles.wrap, className].filter(Boolean).join(" ")} aria-live="polite" aria-atomic="true">
      <AnimatePresence mode="wait" initial={false}>
        {state !== "idle" && (
          <motion.span
            key={state}
            className={[styles.row, styles[state]].join(" ")}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: -3, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 3, scale: 0.96 }}
            transition={{ duration: reduced ? 0.1 : 0.18, ease: "easeOut" }}
          >
            <span className={styles.dot} aria-hidden="true" />
            {LABEL[state]}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}
