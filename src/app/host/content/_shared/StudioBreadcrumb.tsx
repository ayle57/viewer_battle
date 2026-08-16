"use client";

import Link from "next/link";
import styles from "./StudioBreadcrumb.module.css";

export interface Crumb {
  label: string;
  href?: string;
}

/**
 * Where-am-I, always visible, at the top of every /host/content/* screen —
 * "the Host must always understand where he is" (product brief section
 * 15). VIEWERBATTLE is always first and always links to `/`; every crumb
 * after it is caller-supplied (Content Studio -> Jeopardy -> a playlist
 * name, as deep as the current screen goes) and only the LAST one is
 * rendered as plain text — every crumb before it is a real link, so the
 * Host can jump back to any level in one click, not just "back one step."
 * "← Host Lobby" is a second, separate escape hatch back to `/host`
 * itself (the live-session Control Room), not part of the crumb trail —
 * distinct destinations, kept visually distinct.
 */
export function StudioBreadcrumb({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <div className={styles.row}>
      <Link href="/host" className={styles.hostLobbyLink}>
        ← Host Lobby
      </Link>
      <nav className={styles.trail} aria-label="Content Studio breadcrumb">
        <Link href="/" className={styles.brand}>
          VIEWERBATTLE
        </Link>
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          return (
            <span className={styles.crumbWrap} key={`${crumb.label}-${index}`}>
              <span className={styles.sep} aria-hidden="true">
                /
              </span>
              {crumb.href && !isLast ? (
                <Link href={crumb.href} className={styles.crumb}>
                  {crumb.label}
                </Link>
              ) : (
                <span className={styles.crumbCurrent} aria-current="page">
                  {crumb.label}
                </span>
              )}
            </span>
          );
        })}
      </nav>
    </div>
  );
}
