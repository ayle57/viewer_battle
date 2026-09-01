import type { SteamRatingsPlaylistReadiness } from "@/domain/content";
import styles from "./ReadinessBadge.module.css";

/**
 * Steam Ratings' counterpart to ReadinessBadge.tsx's `ReadinessLine` /
 * GeoReadinessBadge.tsx's `GeoReadinessLine` / DrawingReadinessBadge.tsx's
 * `DrawingReadinessLine` / MusicReadinessBadge.tsx's `MusicReadinessLine`
 * — same visual language (same CSS module, same glyph vocabulary, same
 * "· counts" trailing clause), genuinely different wording because this
 * game's content has no "category"/"round"/"track" concept, just games
 * (src/domain/content/steamReadiness.ts). `ReadinessBadge` itself (the
 * small pill) IS reused as-is here too — it only ever reads `.status`,
 * and `SteamRatingsPlaylistReadinessStatus` is the exact same
 * "empty"/"incomplete"/"ready" vocabulary — only this fuller line, which
 * needs game-specific counts, gets its own small component.
 */
export function SteamReadinessLine({ readiness }: { readiness: SteamRatingsPlaylistReadiness }) {
  const glyph = readiness.status === "ready" ? "✓" : readiness.status === "incomplete" ? "⚠" : "○";
  return (
    <p className={[styles.line, styles[readiness.status]].join(" ")}>
      <span aria-hidden="true">{glyph}</span>
      <span>{readiness.summary}</span>
      {readiness.gameCount > 0 && (
        <span className={styles.counts}>
          · {readiness.completeGameCount}/{readiness.gameCount} games ready
        </span>
      )}
    </p>
  );
}
