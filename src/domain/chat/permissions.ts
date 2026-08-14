import type { ChatChannel, ChatRole } from "./schemas";

/** Channels (rooms) a role automatically joins on connect. */
export function channelsForRole(role: ChatRole): ChatChannel[] {
  switch (role) {
    case "HOST":
      return ["TEAM_A", "TEAM_B", "PUBLIC"];
    case "TEAM_A":
      return ["TEAM_A", "PUBLIC"];
    case "TEAM_B":
      return ["TEAM_B", "PUBLIC"];
    case "DISPLAY":
      return ["PUBLIC"];
  }
}

/**
 * Whether a role may post a message into a given channel.
 *
 * - Host can post anywhere (moderation / announcements).
 * - Team A/B can only post to their own private channel, not PUBLIC
 *   (PUBLIC is a host-announcements / display-facing channel, read-only
 *   for teams even though they receive it).
 * - Display never posts — it's a read-only OBS/browser overlay surface.
 */
export function canPostToChannel(role: ChatRole, channel: ChatChannel): boolean {
  switch (role) {
    case "DISPLAY":
      return false;
    case "HOST":
      return true;
    case "TEAM_A":
      return channel === "TEAM_A";
    case "TEAM_B":
      return channel === "TEAM_B";
  }
}
