import type { GeoPlaylistReadiness } from "@/domain/content";
import styles from "./ReadinessBadge.module.css";

/**
 * GeoGuessr's counterpart to ReadinessBadge.tsx's `ReadinessLine` — same
 * visual language (same CSS module, same glyph vocabulary, same "· counts"
 * trailing clause), genuinely different WORDING because GeoGuessr's
 * content has no "category" concept and its unit is "rounds," not
 * "questions" (see src/domain/content/geoReadiness.ts). `ReadinessBadge`
 * itself (the small pill) IS reused as-is for GeoGuessr — it only ever
 * reads `.status`, and `GeoPlaylistReadinessStatus` is the exact same
 * "empty"/"incomplete"/"ready" vocabulary — only this fuller line, which
 * needs round-specific counts, gets its own small component instead of
 * forcing GeoPlaylistReadiness into ReadinessLine's Jeopardy-shaped
 * `categoryCount`/`questionCount` props.
 */
export function GeoReadinessLine({ readiness }: { readiness: GeoPlaylistReadiness }) {
  const glyph = readiness.status === "ready" ? "✓" : readiness.status === "incomplete" ? "⚠" : "○";
  return (
    <p className={[styles.line, styles[readiness.status]].join(" ")}>
      <span aria-hidden="true">{glyph}</span>
      <span>{readiness.summary}</span>
      {readiness.roundCount > 0 && (
        <span className={styles.counts}>
          · {readiness.completeRoundCount}/{readiness.roundCount} rounds ready
        </span>
      )}
    </p>
  );
}
