import type { DrawingPlaylistReadiness } from "@/domain/content";
import styles from "./ReadinessBadge.module.css";

/**
 * Drawing's counterpart to ReadinessBadge.tsx's `ReadinessLine` /
 * GeoReadinessBadge.tsx's `GeoReadinessLine` — same visual language (same
 * CSS module, same glyph vocabulary, same "· counts" trailing clause),
 * genuinely different wording because Drawing's content has no
 * "category"/"round" concept, just prompts (see
 * src/domain/content/drawingReadiness.ts). `ReadinessBadge` itself (the
 * small pill) IS reused as-is here too — it only ever reads `.status`,
 * and `DrawingPlaylistReadinessStatus` is the exact same
 * "empty"/"incomplete"/"ready" vocabulary — only this fuller line, which
 * needs prompt-specific counts, gets its own small component.
 */
export function DrawingReadinessLine({ readiness }: { readiness: DrawingPlaylistReadiness }) {
  const glyph = readiness.status === "ready" ? "✓" : readiness.status === "incomplete" ? "⚠" : "○";
  return (
    <p className={[styles.line, styles[readiness.status]].join(" ")}>
      <span aria-hidden="true">{glyph}</span>
      <span>{readiness.summary}</span>
      {readiness.promptCount > 0 && (
        <span className={styles.counts}>
          · {readiness.completePromptCount}/{readiness.promptCount} prompts ready
        </span>
      )}
    </p>
  );
}
