import { z } from "zod";

/**
 * Canonical participant role, owned by the domain layer. This is THE role
 * type — src/domain/chat re-exports it as `ChatRole` for backward
 * compatibility with its existing public API, rather than defining its
 * own copy (see src/domain/chat/schemas.ts).
 *
 * Kept in sync with the Prisma `ParticipantRole` enum by hand; see
 * tests/unit/session-domain-prisma-sync.test.ts.
 */
export const participantRoleSchema = z.enum(["HOST", "TEAM_A", "TEAM_B", "DISPLAY"]);
export type ParticipantRole = z.infer<typeof participantRoleSchema>;

export const TEAM_ROLES = ["TEAM_A", "TEAM_B"] as const satisfies readonly ParticipantRole[];
export type TeamRole = (typeof TEAM_ROLES)[number];

export const teamRoleSchema = z.enum(TEAM_ROLES);

export function isTeamRole(role: ParticipantRole): role is TeamRole {
  return (TEAM_ROLES as readonly string[]).includes(role);
}
