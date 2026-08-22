/**
 * Socket.IO room name for ONE specific participant, across every socket
 * they hold (a participant can have more than one tab/device open — see
 * presence.ts's refcounting). Every other room in this app (see
 * src/domain/game/rooms.ts, src/domain/chat/rooms.ts) targets a whole
 * ROLE — "host", "team_a", everyone on a team — because game state and
 * chat redact identically for every member of that role. Kicking one
 * player off their team is the first case that genuinely needs to reach
 * exactly one participant and no one else: `participant:kicked`
 * (src/server/sockets/session.ts's `broadcastParticipantKicked`) has to
 * land on the kicked player's own socket(s), not their teammate's.
 */
export function participantRoomName(participantId: string): string {
  return `participant:${participantId}`;
}
