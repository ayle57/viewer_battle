import type { ParticipantRole } from "@/domain/session";

export const ROLE_LABEL: Record<ParticipantRole, string> = {
  HOST: "Host",
  TEAM_A: "Team A",
  TEAM_B: "Team B",
  DISPLAY: "Display",
};
