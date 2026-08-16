import type { ParticipantRole } from "@/domain/session";

/**
 * Socket.IO room names for game state, split by audience the same way
 * chat is split by channel (see src/domain/chat/rooms.ts). Socket.IO has
 * no "different payload per member of a room" primitive, so a role that
 * needs its own redaction needs its own room.
 *
 * `"host"` and `"public"` are the ORIGINAL two rooms — every socket still
 * joins one of these (src/server/sockets/game.ts's registerGameHandlers)
 * because other broadcasters (presence.ts, session.ts's session:ended)
 * only ever need "host" vs. "everyone else" and were never touched by
 * the addition below.
 *
 * `"team_a"` / `"team_b"` / `"display"` exist for `game:state`
 * specifically, added when GeoGuessrEngine's toPublicView turned out to
 * need a redaction that genuinely differs BY TEAM (a team's own guess
 * vs. the other team's) — exactly the case this file's own comment used
 * to flag as a future need. `broadcastGameSnapshot`
 * (src/server/sockets/game.ts) now emits to ALL FOUR concrete roles
 * (host/team_a/team_b/display) rather than lumping team_a/team_b/display
 * into one shared "public" emit — for an engine like BoardQuestionEngine,
 * whose `toPublicView` redacts identically for every non-host role, this
 * produces three byte-identical payloads to three different rooms
 * instead of one payload to one shared room: functionally indistinguishable
 * to any client, and it means no FUTURE engine needs a special case here
 * either — every engine gets genuinely correct per-role delivery, always.
 */
export type GameAudience = "host" | "public" | "team_a" | "team_b" | "display";

export function gameRoomName(sessionId: string, audience: GameAudience): string {
  return `session:${sessionId}:game:${audience}`;
}

/** Maps a concrete participant role to its own `game:state` room — the audience `broadcastGameSnapshot` targets for that exact role's redacted view. */
export function gameAudienceForRole(role: ParticipantRole): GameAudience {
  switch (role) {
    case "HOST":
      return "host";
    case "TEAM_A":
      return "team_a";
    case "TEAM_B":
      return "team_b";
    case "DISPLAY":
      return "display";
  }
}
