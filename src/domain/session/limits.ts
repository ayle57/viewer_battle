/**
 * Locked session limits — see AGENTS.md "Session invariants" for the
 * full rationale. Changing these is a real product decision, not a
 * tuning knob; the Postgres constraints in prisma/schema.prisma enforce
 * MAX_PLAYERS_PER_TEAM independently of this constant (via the
 * (sessionId, role, seat) unique index), so bumping this number alone is
 * NOT enough to change the real limit — the migration has to change too.
 */
export const MAX_PLAYERS_PER_TEAM = 2;
export const MAX_PLAYERS_TOTAL = MAX_PLAYERS_PER_TEAM * 2;
