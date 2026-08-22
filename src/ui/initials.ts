/**
 * Up to two initials from a display name/username — the one derivation
 * every avatar bubble in the app shares (PlayerCard, TeamRoster's own
 * seat avatars, the admin panel's account table), so "JL" for "Jamie Lee"
 * reads the same everywhere instead of three slightly different splits.
 * A single word (the common case — most pseudos/usernames are one token,
 * no spaces) falls back to its own first TWO characters rather than just
 * one, so a lone "erwin" still reads as "ER", not a lonely "E".
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
