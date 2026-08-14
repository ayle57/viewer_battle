"use client";

import type { ReactNode } from "react";
import styles from "./DebugPanel.module.css";

/**
 * Collapsed-by-default `<details>` wrapper for anything developer-facing
 * that a real host/player/display screen has no business showing by
 * default (raw error codes, TODO-backend panels, connection internals) —
 * see the stabilization pass instructions: the playground should be
 * usable without reading the code, but nothing here disappears, it just
 * stops being in the way. Plain `<details>`, no JS state: works without
 * hydration, keyboard-accessible for free.
 */
export function DebugPanel({ children, title = "Debug" }: { children: ReactNode; title?: string }) {
  return (
    <details className={styles.details}>
      <summary className={styles.summary}>{title}</summary>
      <div className={styles.body}>{children}</div>
    </details>
  );
}
