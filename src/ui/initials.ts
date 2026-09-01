/**
 * Up to two initials from a display name/username — the one derivation
 * every avatar bubble in the app shares (`Avatar` — src/ui/components/
 * Avatar, used by AccountBadge/PlayerCard/the admin accounts table — and
 * TeamRoster's own seat avatars, which stay their own team-tinted
 * treatment but still derive initials the same way), so "JL" for "Jamie
 * Lee" reads the same everywhere instead of several slightly different
 * splits. A single word (the common case — most pseudos/usernames are
 * one token, no spaces) falls back to its own first TWO characters
 * rather than just one, so a lone "Nadia" still reads as "NA", not a
 * lonely "E".
 */
export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return parts
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

/**
 * How many distinct avatar background colors exist — `Avatar` (src/ui/
 * components/Avatar) is the one caller that picks one by index
 * (`avatarColorIndex` below) and switches on it via its own CSS module
 * (`styles[\`identity${index}\`]`), same "className switching, not
 * inline styles" convention TeamRoster's own `styles[variant]` already
 * uses for its team-tinted seats. Kept as a plain count, not the color
 * values themselves — those live once, as real CSS custom-property
 * references, in `Avatar.module.css`, so its dark-mode variables apply
 * automatically without this file needing to know about themes at all.
 */
export const AVATAR_COLOR_COUNT = 5;

/**
 * A real, reported fix ("les photos de profil... sont cheum") — every
 * avatar bubble that reaches this function used to render the exact
 * same flat, low-contrast tint for every single user (one shared
 * `color-mix(primary 18%, surface)`), which is why it read as bland:
 * nothing distinguished one person's avatar from another's the way a
 * real profile picture would. This derives a stable index [0, N) from
 * the name itself — same person, same color, every time, every session,
 * no state to store — the same "hash the identity into a palette slot"
 * trick Slack/Discord/GitHub's own colorful initials avatars use. Pure
 * djb2-style hash (multiply-and-add over char codes); the exact
 * algorithm doesn't matter, only that it's stable and spreads names
 * reasonably evenly across the palette.
 */
export function avatarColorIndex(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0; // unsigned 32-bit wrap, never negative
  }
  return hash % AVATAR_COLOR_COUNT;
}
