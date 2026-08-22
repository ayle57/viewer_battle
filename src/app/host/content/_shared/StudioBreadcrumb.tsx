"use client";

import Link from "next/link";
import { useContentIdentityStore } from "./contentIdentityStore";
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
 *
 * Also carries a persistent "Admin" link (/host/content/admin — real
 * `User` accounts + platform stats, gated by this SAME ContentHost token,
 * see adminRouter.ts's own doc comment) — reachable from every
 * /host/content/* screen for the same reason "Sign out" is, rather than
 * depending on `/host/content`'s own picker grid always being the one
 * that's rendered (a future third content-capable game would make that
 * grid stop being every Host's actual landing point — see that page's
 * own `manageableGames.length === 1` redirect).
 *
 * Also the one place a Host can sign OUT of the Content Studio identity
 * (contentIdentityStore.ts's own doc comment explains why signing IN
 * persists across server restarts / browser reopens: a bearer token in
 * localStorage, checked against Postgres, which a Node restart never
 * touches — expected, not a bug). Rendered on every /host/content/*
 * screen (see each page's own usage), so putting "Sign out" here rather
 * than on any one page means it's reachable from anywhere, not just one
 * screen — no new prop threading, no new chrome elsewhere.
 */
export function StudioBreadcrumb({ crumbs }: { crumbs: Crumb[] }) {
  const clearToken = useContentIdentityStore((s) => s.clearToken);
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
      <Link href="/host/content/admin" className={styles.adminLink}>
        Admin
      </Link>
      <button type="button" className={styles.signOut} onClick={() => clearToken()}>
        Sign out
      </button>
    </div>
  );
}
