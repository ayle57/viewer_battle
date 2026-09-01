import type { MusicPlaylistReadiness } from "@/domain/content";
import styles from "./ReadinessBadge.module.css";

/**
 * Music's counterpart to ReadinessBadge.tsx's `ReadinessLine` /
 * GeoReadinessBadge.tsx's `GeoReadinessLine` / DrawingReadinessBadge.tsx's
 * `DrawingReadinessLine` — same visual language (same CSS module, same
 * glyph vocabulary, same "· counts" trailing clause), genuinely different
 * wording because Music's content has no "category"/"round" concept, just
 * tracks (see src/domain/content/musicReadiness.ts). `ReadinessBadge`
 * itself (the small pill) IS reused as-is here too — it only ever reads
 * `.status`, and `MusicPlaylistReadinessStatus` is the exact same
 * "empty"/"incomplete"/"ready" vocabulary — only this fuller line, which
 * needs track-specific counts, gets its own small component.
 */
export function MusicReadinessLine({ readiness }: { readiness: MusicPlaylistReadiness }) {
  const glyph = readiness.status === "ready" ? "✓" : readiness.status === "incomplete" ? "⚠" : "○";
  return (
    <p className={[styles.line, styles[readiness.status]].join(" ")}>
      <span aria-hidden="true">{glyph}</span>
      <span>{readiness.summary}</span>
      {readiness.trackCount > 0 && (
        <span className={styles.counts}>
          · {readiness.completeTrackCount}/{readiness.trackCount} tracks ready
        </span>
      )}
    </p>
  );
}
