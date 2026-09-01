import { avatarColorIndex, getInitials } from "../../initials";
import styles from "./Avatar.module.css";

export type AvatarSize = "sm" | "md";

export interface AvatarProps {
  name: string;
  size?: AvatarSize;
  className?: string;
}

/**
 * The one avatar bubble — initials (`getInitials`) on a stable, vibrant
 * per-name color (`avatarColorIndex`, both src/ui/initials.ts) — for
 * every screen that represents "this person, by name, with no team
 * context." A real, audited gap this closes: AccountBadge and the admin
 * accounts table had already converged on this exact look independently
 * (each with its own copy of the same five `.avatarColorN` rules), while
 * PlayerCard (the one showcased in /dev/components — not reachable from
 * any real Host/Player/Display screen today, TeamRoster replaced it
 * there, see TeamRoster's own doc comment) still drew a flat, colorless
 * circle with no identity signal at all. One component now, not three
 * copies of the same idea drifting independently.
 *
 * Deliberately NOT what TeamRoster's own seat avatars use — a roster
 * seat's color means "which TEAM this is," a real, different semantic
 * fact worth keeping (see TeamRoster.module.css's own doc comment on
 * this exact exclusion), not an oversight this component forgot to
 * cover.
 */
export function Avatar({ name, size = "md", className }: AvatarProps) {
  return (
    <span className={[styles.avatar, styles[size], styles[`identity${avatarColorIndex(name)}`], className].filter(Boolean).join(" ")} aria-hidden="true">
      {getInitials(name)}
    </span>
  );
}
