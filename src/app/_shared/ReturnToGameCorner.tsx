"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useIdentityStore } from "@/app/_shared/identityStore";
import type { ParticipantRole } from "@/domain/session";
import styles from "./ReturnToGameCorner.module.css";

/** Where each seat's live game screen actually lives — the one place this mapping needs to exist. */
const ROUTE_FOR_ROLE: Record<ParticipantRole, string> = {
  HOST: "/host",
  TEAM_A: "/player",
  TEAM_B: "/player",
  DISPLAY: "/display",
};

/**
 * Real, reported gap: "guetter son compte" (checking /account mid-game,
 * the same 👤 link Player's own topBar offers — see player/page.tsx)
 * left with no way back except re-typing the session code or hitting the
 * browser's back button. `identityStore.ts`'s own per-tab seat is
 * untouched by navigating away and back (that's the whole premise the
 * 👤 link already leans on) — this is just the missing return half of
 * that trip, surfaced everywhere instead of hand-added page by page.
 *
 * Mounted once, globally, in the root layout (not per-page like
 * `AccountCorner`) precisely because "somewhere else" is any page, not
 * one specific destination — /account is just the example that prompted
 * this, not the only place a mid-game detour can happen.
 *
 * Renders nothing whenever there's nothing useful to say: no stored
 * identity at all, already ON that identity's own game route (nothing to
 * "return" to from here), or under /dev (devIdentityStore.ts is a
 * deliberately separate identity system — this seat has no bearing on
 * what that playground is showing).
 */
export function ReturnToGameCorner() {
  const identity = useIdentityStore((state) => state.identity);
  const pathname = usePathname();

  if (!identity || pathname.startsWith("/dev")) return null;

  const gameRoute = ROUTE_FOR_ROLE[identity.role];
  if (pathname === gameRoute) return null;

  return (
    <div className={styles.corner}>
      <Link href={gameRoute} className={styles.pill}>
        <span className={styles.dot} aria-hidden="true" />
        <span>
          Back to game <span className={styles.code}>#{identity.sessionCode}</span>
        </span>
      </Link>
    </div>
  );
}
