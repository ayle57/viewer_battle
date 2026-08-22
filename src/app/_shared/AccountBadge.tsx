"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { trpc } from "@/app/_trpc/client";
import { useAccountStore } from "@/app/_shared/accountStore";
import { ActionsMenu } from "@/app/_shared/ActionsMenu";
import { getInitials } from "@/ui/initials";
import styles from "./AccountBadge.module.css";

/**
 * The ONE visual shape "you're signed into an account" takes anywhere on
 * the site with room for it (a fixed corner, a join form, a gate screen)
 * — a small pill with an initials avatar + a green dot when signed in,
 * plain "Log in" text when not. The avatar (same `getInitials` treatment
 * as TeamRoster's seats and the admin table, not a third derivation) is
 * a real, reported fix — this pill used to be text-only, the one
 * genuinely constant piece of chrome on the whole site that had no
 * visual identity marker at all. Previously three different treatments
 * for the exact same fact (a
 * pill on the homepage, a plain underlined text link on /player's join
 * form, a CardHeader subtitle on /host's gate) — genuinely harder to use,
 * not just inconsistent: a visitor who'd learned to recognize one didn't
 * recognize the others as the same thing. One component, one look, so
 * recognizing it once means recognizing it everywhere.
 *
 * Signed OUT, this stays a plain `Link` to `/account` — nothing to choose
 * between yet. Signed IN, it becomes an ActionsMenu trigger: the pill
 * itself opens a short menu (My account, Admin/Content Studio when
 * `isAdmin`, Log out) instead of only ever linking to `/account` — a real,
 * reported gap ("il ne puisse pas... naviguer" — reaching the admin panel
 * or logging out both required a detour through the profile page first,
 * even though the pill is visible on every screen that has room for it).
 * Built on ActionsMenu's click-to-open popover rather than a CSS
 * `:hover` menu on purpose — hover has no equivalent on a touch screen,
 * and every other secondary-actions menu in the app (Content Studio
 * cards, /host's header) already opens the same way, so this stays one
 * interaction pattern site-wide, not a second one just for this pill.
 *
 * Deliberately NOT used inside a live game's own compact chrome
 * (`PlayerGeoPanel`'s topBar keeps its own icon-only 👤 button, `/host`'s
 * live header shows nothing extra at all) — those are space-constrained,
 * already-trimmed rows (see player/page.tsx's own Round 14 chrome-
 * reduction comments), and only ONE account can ever host in the first
 * place, so restating "signed in as X" there would be more chrome for
 * zero new information, not simpler.
 */
export function AccountBadge() {
  const account = useAccountStore((state) => state.account);
  const clearAccount = useAccountStore((state) => state.clearAccount);
  const router = useRouter();
  const logout = trpc.user.logout.useMutation();

  if (!account) {
    return (
      <Link href="/account" className={`${styles.badge} ${styles.badgeLoggedOut}`}>
        Log in
      </Link>
    );
  }

  // A REAL, server-side logout (same call /account's own "Log out" button
  // makes) — best-effort, sign out locally either way, matching
  // handleLogout's own comment there: a stale/already-invalid token must
  // never strand this menu unable to sign the tab out.
  const token = account.token;
  function handleLogout() {
    void logout.mutateAsync({ token }).catch(() => undefined);
    clearAccount();
  }

  const items = [
    { label: "My account", onSelect: () => router.push("/account") },
    ...(account.isAdmin
      ? [
          { label: "Content Studio", onSelect: () => router.push("/host/content") },
          { label: "Admin", onSelect: () => router.push("/host/content/admin") },
        ]
      : []),
    { label: "Log out", onSelect: handleLogout, danger: true },
  ];

  return (
    <ActionsMenu
      label={`Account menu for ${account.username}`}
      triggerClassName={styles.badge}
      trigger={
        <>
          <span className={styles.avatar} aria-hidden="true">
            {getInitials(account.username)}
          </span>
          <span className={styles.name}>{account.username}</span>
          <span className={styles.dot} aria-hidden="true" title="Signed in" />
        </>
      }
      items={items}
    />
  );
}
