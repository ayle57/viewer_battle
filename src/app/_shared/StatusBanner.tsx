"use client";

import styles from "./StatusBanner.module.css";

export type StatusBannerTone = "warning" | "danger";

/**
 * The one visual language this app already uses for "something about
 * connectivity needs your attention, shown ON TOP of whatever's already
 * on screen, never in place of it" — originally HostDisconnectedBanner's
 * own markup/copy verbatim (a disconnected HOST, seen by Player/Display),
 * pulled out here so the identical situation for THIS tab's own socket
 * (Player/Display's own `status` from gameStore.ts, ConnectionBadge.tsx's
 * same source of truth) gets the same treatment instead of a second,
 * differently-styled banner invented from scratch. `warning` (the
 * default) is socket.io's own reconnection loop — self-healing, nothing
 * lost; `danger` is `unauthorized`, a genuine dead end (this tab's token
 * was rejected — see ConnectionBadge.tsx's identical variant reasoning).
 */
export function StatusBanner({ tone = "warning", title, subtitle }: { tone?: StatusBannerTone; title: string; subtitle: string }) {
  return (
    <div className={[styles.banner, tone === "danger" && styles.danger].filter(Boolean).join(" ")} role="status">
      <p className={styles.title}>{title}</p>
      <p className={styles.subtitle}>{subtitle}</p>
    </div>
  );
}
