"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import styles from "./ContentReadinessNotice.module.css";

export interface ContentReadinessNoticeProps {
  /** The content type's own name, lowercase, singular — "board", "map set", "prompt list", "playlist" — slotted into "This {name} isn't ready yet." / "Review {name} →". */
  contentTypeName: string;
  readiness: { ready: boolean };
  reviewHref: string;
  onUseSample: () => void;
  /** The engine-specific readiness detail line (ReadinessLine/GeoReadinessLine/DrawingReadinessLine/…) — rendered only in the not-ready state, right under the shared title. */
  children: ReactNode;
}

/**
 * One shared message structure for "this content isn't ready to play" —
 * replaces six near-identical, independently-drifted copies that used to
 * live inline in host/page.tsx (one per game: board/map set/prompt
 * list/playlist×3), each with its own slightly different punctuation
 * ("This board isn't ready" was even missing the trailing "yet."). Same
 * ponctuation, same structure, every time — only `contentTypeName`
 * changes, and the engine-specific readiness detail (`children`) and
 * review link target, both still genuinely per-engine.
 *
 * Renders the "✓ Ready to play" line instead once `readiness.ready` is
 * true — the two states were always a matched pair at each of those six
 * call sites, so this is one component either way rather than two things
 * a caller has to remember to keep in sync.
 */
export function ContentReadinessNotice({ contentTypeName, readiness, reviewHref, onUseSample, children }: ContentReadinessNoticeProps) {
  if (readiness.ready) {
    return <p className={styles.readinessOk}>✓ Ready to play</p>;
  }

  return (
    <div className={styles.readinessWarning}>
      <p className={styles.readinessWarningTitle}>⚠ This {contentTypeName} isn&apos;t ready yet.</p>
      {children}
      <div className={styles.readinessWarningActions}>
        <Link href={reviewHref} className={styles.reviewLink}>
          Review {contentTypeName} →
        </Link>
        <button type="button" className={styles.useSampleLink} onClick={onUseSample}>
          Use sample content instead
        </button>
      </div>
    </div>
  );
}
