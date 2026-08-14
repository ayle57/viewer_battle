import type { ParticipantRole } from "@/domain/session";
import type { ChatMessageRole } from "@/ui";

export const ROLE_LABEL: Record<ParticipantRole, string> = {
  HOST: "Host",
  TEAM_A: "Team A",
  TEAM_B: "Team B",
  DISPLAY: "Display",
};

/** ParticipantRole -> ChatMessage's own UI role type (see src/ui/components/ChatMessage — deliberately not the same type, so that component stays reusable outside this app's role vocabulary). */
export function toChatMessageRole(role: ParticipantRole): ChatMessageRole {
  switch (role) {
    case "HOST":
      return "host";
    case "TEAM_A":
      return "team-a";
    case "TEAM_B":
      return "team-b";
    case "DISPLAY":
      return "display";
  }
}
