"use client";

import type { TeamRole } from "@/domain/session";

/**
 * A pure convenience — remembers whatever display name was last used
 * successfully on THIS browser, across sessions and games. Real, reported
 * friction: finishing a game and joining a fresh one meant retyping the
 * exact same name every single time.
 *
 * Scoped per ROLE ("player-team-a" / "player-team-b" / "host" /
 * "display"), each its own storage key — NOT one shared key. The
 * original one-key design assumed a browser only ever plays one role for
 * one real person, which real usage disproved: the same machine/browser
 * is routinely used to both host a game (e.g. "Coach") and join one as a
 * player (e.g. "Zara") — a shared key meant joining a new game as a
 * player pre-filled the HOST's last name instead of the player's own.
 *
 * Player itself is further split by TEAM — a REAL, REPORTED bug this
 * closes ("j'ai joué en tant que test3 et... ça a mis test2"): solo
 * testing (or a streamer prepping both seats before real players arrive)
 * routinely joins Team A in one tab/turn and Team B in another, on the
 * SAME browser. A single shared "player" key meant whichever team was
 * joined LAST silently overwrote the OTHER team's own remembered name —
 * the exact same "wrong role's name leaks into a different role's field"
 * failure mode the host/player/display split above already exists to
 * prevent, just not carried through to team.
 *
 * `localStorage`, not `sessionStorage` (identityStore.ts's own deliberate
 * choice, for a REAL reason — a second tab must be able to become a
 * different participant) — this is a plain UI convenience with no
 * identity/security weight at all, meant to survive closing the tab
 * entirely, the opposite of identityStore's own scoping.
 */
export type DisplayNameScope = "player-team-a" | "player-team-b" | "host" | "display";

/** The player scope for a given team — the one place `TeamRole` -> `DisplayNameScope` mapping lives, so player/page.tsx never hand-rolls the ternary itself. */
export function playerScope(team: TeamRole): DisplayNameScope {
  return team === "TEAM_A" ? "player-team-a" : "player-team-b";
}

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

/**
 * The same convenience as the display name above, but for which TEAM was
 * last picked — real, reported friction: finishing a game and joining the
 * next one (a fresh session, or another one on a later day) always reset
 * the team picker back to Team A, even for someone who's played Team B all
 * night. One shared key, deliberately NOT split per-team the way
 * `DisplayNameScope` is — there's nothing to leak here (unlike a name,
 * "which team was picked" has only one value per browser at a time, it IS
 * the thing being remembered), so a second key would just be two places
 * for the same fact to disagree.
 */
const LAST_TEAM_KEY = "viewerbattle-last-player-team";

export function getLastTeam(): TeamRole | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(LAST_TEAM_KEY);
    return value === "TEAM_A" || value === "TEAM_B" ? value : null;
  } catch {
    return null; // Same reasoning as getLastDisplayName's own catch.
  }
}

/** Called once a join actually SUCCEEDS — same "only remember what worked" timing as saveLastDisplayName. */
export function saveLastTeam(team: TeamRole): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAST_TEAM_KEY, team);
  } catch {
    // Same reasoning as getLastDisplayName's own catch.
  }
}
