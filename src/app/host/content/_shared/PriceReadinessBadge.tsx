import type { GuessThePricePlaylistReadiness } from "@/domain/content";
import styles from "./ReadinessBadge.module.css";

/**
 * Guess the Price's counterpart to ReadinessBadge.tsx's `ReadinessLine` /
 * GeoReadinessBadge.tsx's `GeoReadinessLine` / DrawingReadinessBadge.tsx's
 * `DrawingReadinessLine` / MusicReadinessBadge.tsx's `MusicReadinessLine`
 * / SteamReadinessBadge.tsx's `SteamReadinessLine` — same visual language
 * (same CSS module, same glyph vocabulary, same "· counts" trailing
 * clause), genuinely different wording because this game's content has
 * no "category"/"round"/"track"/"game" concept, just ITEMS
 * (src/domain/content/priceReadiness.ts). `ReadinessBadge` itself (the
 * small pill) IS reused as-is here too — it only ever reads `.status`,
 * and `GuessThePricePlaylistReadinessStatus` is the exact same
 * "empty"/"incomplete"/"ready" vocabulary — only this fuller line, which
 * needs game-specific counts, gets its own small component.
 */
export function PriceReadinessLine({ readiness }: { readiness: GuessThePricePlaylistReadiness }) {
  const glyph = readiness.status === "ready" ? "✓" : readiness.status === "incomplete" ? "⚠" : "○";
  return (
    <p className={[styles.line, styles[readiness.status]].join(" ")}>
      <span aria-hidden="true">{glyph}</span>
      <span>{readiness.summary}</span>
      {readiness.itemCount > 0 && (
        <span className={styles.counts}>
          · {readiness.completeItemCount}/{readiness.itemCount} items ready
        </span>
      )}
    </p>
  );
}
