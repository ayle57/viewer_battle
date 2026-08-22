"use client";

import { AccountBadge } from "@/app/_shared/AccountBadge";
import styles from "./AccountCorner.module.css";

/**
 * A real, reported UX complaint this closes: the account system's only
 * front-door entry point used to be a text link jammed into the
 * homepage's own CTA row — competing with "Host a Game"/"Join a Game"
 * for attention on a landing page that's already doing a lot (cinematic
 * hero, scroll story, live board demo). A fixed top-right corner badge
 * is the opposite: always reachable, never IN the way of the actual
 * pitch, the same "light navbar" pattern most marketing sites use for
 * "Log in" — small, quiet, off to the side.
 *
 * Just a positioning wrapper now — the actual pill (dot + username, or
 * "Log in") is `AccountBadge` (src/app/_shared/), the SAME visual shape
 * reused on /player's join form and /host's gate screen, so "signed in"
 * looks and behaves identically everywhere it appears.
 *
 * Below PageChangeCurtain's z-index (200, so a route transition still
 * fully covers it) and above ScrollProgress's own top-edge bar (150).
 */
export function AccountCorner() {
  return (
    <div className={styles.corner}>
      <AccountBadge />
    </div>
  );
}
