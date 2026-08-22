import type { TeamRosterSeat } from "@/ui";
import type { PresenceParticipant } from "./presenceStore";

/**
 * Merges a session's roster (session.getState — who has a seat, from
 * Postgres, polled every 2s) with real presence (presence:update — who's
 * actually connected right now, from src/server/sockets/presence.ts,
 * pushed instantly) by participant id. Pure and tiny on purpose: no new
 * presence system, just joining the two the frontend already has.
 *
 * A REAL, REPRODUCED bug this closes: `participants` (the polled roster)
 * used to be the ONLY source of who gets a seat rendered at all —
 * `presence` was consulted purely for the green/gray dot on someone
 * ALREADY in that list. Confirmed directly: a fresh join is known
 * instantly via `presence:update` (real-time), but the Host's own Lobby
 * still rendered "Empty seat" for that exact player 150ms later — the
 * next `session.getState` poll tick (up to ~2s away) hadn't landed yet.
 * `presence` already carries everything needed to render a seat
 * (`participantId`/`displayName`/`role`) — this folds in anyone who's
 * present-for-this-role but not yet in the polled list, instead of
 * making the Host wait out the poll to see someone who's already
 * connected and (if this is mid-game) already playing. `role` is now
 * required so this can filter `presence` down to the ONE team/role this
 * particular seat list is for — `presence` itself has no notion of
 * "team A's roster" on its own, only "everyone connected right now."
 * The one honest tradeoff: a presence-only entry's exact SEAT NUMBER
 * (1 vs 2) isn't known yet (only the DB decides that) — it renders in
 * whatever slot `TeamRoster` has left, correcting itself silently once
 * the very next poll confirms the real assignment. Same "trade a small,
 * self-correcting cosmetic gap for staying honest instead of guessing"
 * posture this session's other fixes already use.
 */
export function toRosterSeats(
  participants: { id: string; displayName: string }[],
  presence: PresenceParticipant[],
  role: PresenceParticipant["role"],
): TeamRosterSeat[] {
  const connectedIds = new Set(presence.map((p) => p.participantId));
  const knownIds = new Set(participants.map((p) => p.id));
  const fromRoster = participants.map((p) => ({ id: p.id, displayName: p.displayName, connected: connectedIds.has(p.id) }));
  const fromPresenceOnly = presence
    .filter((p) => p.role === role && !knownIds.has(p.participantId))
    .map((p) => ({ id: p.participantId, displayName: p.displayName, connected: true }));
  return [...fromRoster, ...fromPresenceOnly];
}
