import type { TeamRosterSeat } from "@/ui";
import type { PresenceParticipant } from "./presenceStore";

/**
 * Merges a session's roster (session.getState — who has a seat, from
 * Postgres) with real presence (presence:update — who's actually
 * connected right now, from src/server/sockets/presence.ts) by
 * participant id. Pure and tiny on purpose: no new presence system, just
 * joining the two the frontend already has.
 */
export function toRosterSeats(
  participants: { id: string; displayName: string }[],
  presence: PresenceParticipant[],
): TeamRosterSeat[] {
  const connectedIds = new Set(presence.map((p) => p.participantId));
  return participants.map((p) => ({ id: p.id, displayName: p.displayName, connected: connectedIds.has(p.id) }));
}
