"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Badge, type BadgeSize } from "@/ui";
import { popIn } from "@/app/_shared/motion/variants";
import type { PlaylistReadinessStatus } from "@/domain/content";
import styles from "./ReadinessBadge.module.css";

export interface ReadinessLike {
  status: PlaylistReadinessStatus;
  summary: string;
  categoryCount: number;
  questionCount: number;
  completeQuestionCount: number;
}

/**
 * The one "is this board ready" badge — Library cards, the playlist
 * editor header, and the Host lobby's "Choose your content" picker all
 * render the SAME `PlaylistReadiness` (src/domain/content/readiness.ts,
 * computed server-side — see contentRouter.ts) through this one
 * component, so the three surfaces can never show conflicting statuses
 * for the same playlist.
 *
 * `AnimatePresence`+`key={status}` gives an actual status CHANGE (fixing
 * the last question flips incomplete -> ready, say) a small pop instead
 * of a silent swap — product brief "Show Preparation" section 13's
 * "readiness change" is real feedback here, not everywhere-motion.
 */
export function ReadinessBadge({ readiness, size = "md" }: { readiness: Pick<ReadinessLike, "status">; size?: BadgeSize }) {
  const reduced = useReducedMotion() ?? false;
  const [variant, label] =
    readiness.status === "ready"
      ? (["success", "Ready"] as const)
      : readiness.status === "incomplete"
        ? (["warning", "Not ready"] as const)
        : (["neutral", "Empty"] as const);

  return (
    <AnimatePresence initial={false}>
      <motion.span key={readiness.status} variants={popIn(reduced, { scale: 0.85 })} initial="hidden" animate="show" style={{ display: "inline-flex" }}>
        <Badge variant={variant} dot size={size}>
          {label}
        </Badge>
      </motion.span>
    </AnimatePresence>
  );
}

/** The fuller line — counts + the human summary sentence, with a status glyph. Used where there's room for more than a badge (the playlist editor header, the Host lobby's validation banner). */
export function ReadinessLine({ readiness }: { readiness: ReadinessLike }) {
  const glyph = readiness.status === "ready" ? "✓" : readiness.status === "incomplete" ? "⚠" : "○";
  return (
    <p className={[styles.line, styles[readiness.status]].join(" ")}>
      <span aria-hidden="true">{glyph}</span>
      <span>{readiness.summary}</span>
      {readiness.questionCount > 0 && (
        <span className={styles.counts}>
          · {readiness.completeQuestionCount}/{readiness.questionCount} questions · {readiness.categoryCount} categor
          {readiness.categoryCount === 1 ? "y" : "ies"}
        </span>
      )}
    </p>
  );
}
