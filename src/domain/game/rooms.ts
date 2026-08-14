/**
 * Socket.IO room names for game state, split by audience the same way
 * chat is split by channel (see src/domain/chat/rooms.ts) — HOST gets the
 * full, unredacted state; everyone else (TEAM_A/TEAM_B/DISPLAY) gets
 * whatever `engine.toPublicView` produces. Two rooms, not one broadcast
 * with per-socket payloads, because Socket.IO has no "different payload
 * per member of a room" primitive.
 */
export type GameAudience = "host" | "public";

export function gameRoomName(sessionId: string, audience: GameAudience): string {
  return `session:${sessionId}:game:${audience}`;
}
