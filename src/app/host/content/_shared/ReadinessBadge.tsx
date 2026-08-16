import { Badge, type BadgeSize } from "@/ui";
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
 */
export function ReadinessBadge({ readiness, size = "md" }: { readiness: Pick<ReadinessLike, "status">; size?: BadgeSize }) {
  if (readiness.status === "ready") {
    return (
      <Badge variant="success" dot size={size}>
        Ready
      </Badge>
    );
  }
  if (readiness.status === "incomplete") {
    return (
      <Badge variant="warning" dot size={size}>
        Needs attention
      </Badge>
    );
  }
  return (
    <Badge variant="neutral" dot size={size}>
      Empty
    </Badge>
  );
}

/** The fuller line — counts + the human summary sentence, with a status glyph. Used where there's room for more than a badge (the playlist editor header, the Host lobby's validation banner). */
export function ReadinessLine({ readiness }: { readiness: ReadinessLike }) {
  const glyph = readiness.status === "ready" ? "✓" : readiness.status === "incomplete" ? "⚠" : "○";
  return (
    <p className={[styles.line, styles[readiness.status]].join(" ")}>
      <span aria-hidden="true">{glyph}</span> {readiness.summary}
      {readiness.questionCount > 0 && (
        <span className={styles.counts}>
          {" "}
          · {readiness.completeQuestionCount}/{readiness.questionCount} questions · {readiness.categoryCount} categor
          {readiness.categoryCount === 1 ? "y" : "ies"}
        </span>
      )}
    </p>
  );
}
