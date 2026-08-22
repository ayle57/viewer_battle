"use client";

/**
 * A pure convenience — remembers whatever display name was last used
 * successfully on THIS browser, across sessions and games. Real, reported
 * friction: finishing a game and joining a fresh one meant retyping the
 * exact same name every single time.
 *
 * Scoped per ROLE ("player" / "host" / "display"), each its own storage
 * key — NOT one shared key. The original one-key design assumed a browser
 * only ever plays one role for one real person, which real usage disproved:
 * the same machine/browser is routinely used to both host a game (e.g.
 * "Coach") and join one as a player (e.g. "Zara") — a shared key meant
 * joining a new game as a player pre-filled the HOST's last name instead
 * of the player's own.
 *
 * `localStorage`, not `sessionStorage` (identityStore.ts's own deliberate
 * choice, for a REAL reason — a second tab must be able to become a
 * different participant) — this is a plain UI convenience with no
 * identity/security weight at all, meant to survive closing the tab
 * entirely, the opposite of identityStore's own scoping.
 */
export type DisplayNameScope = "player" | "host" | "display";

function storageKey(scope: DisplayNameScope): string {
  return `viewerbattle-last-display-name-${scope}`;
}

export function getLastDisplayName(scope: DisplayNameScope): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(storageKey(scope)) ?? "";
  } catch {
    return ""; // localStorage can throw in some sandboxed/private-browsing contexts — never worth failing the page over a convenience
  }
}

/** Called once a join/create actually SUCCEEDS — never on every keystroke, and never the raw, un-trimmed input (same trim the join mutation itself applies). */
export function saveLastDisplayName(scope: DisplayNameScope, name: string): void {
  if (typeof window === "undefined") return;
  const trimmed = name.trim();
  if (!trimmed) return;
  try {
    window.localStorage.setItem(storageKey(scope), trimmed);
  } catch {
    // Same reasoning as getLastDisplayName's own catch — a failed save just means next time isn't pre-filled, not worth surfacing to the user.
  }
}

/**
 * A REAL, REPORTED bug this closes: the prefill above is silent — a
 * genuinely different person sharing the same browser/device for this
 * same role (a phone passed around, a shared laptop) could hit Join
 * without ever noticing the field wasn't empty, inheriting whoever last
 * used it ("j'ai le même pseudo partout"). `RememberedNameHint.tsx` turns
 * that silent prefill into a visible "Playing as X — not you? Log out"
 * strip; this is what "Log out" actually calls — a real, one-click way to
 * disown a wrong prefill instead of the only recourse being "notice it,
 * then manually select-all and retype."
 */
export function clearLastDisplayName(scope: DisplayNameScope): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storageKey(scope));
  } catch {
    // Same reasoning as getLastDisplayName's own catch.
  }
}
