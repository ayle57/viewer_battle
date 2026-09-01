import type { GeoGuessrConfig } from "./types";

/**
 * FIXTURE DATA — not real show content, same posture as
 * boardQuestion/fixtures.ts's sampleBoard. Two rounds is enough to
 * exercise a full guess -> lock -> reveal -> next round -> reveal ->
 * finish cycle in engine.test.ts without a long board. Coordinates are
 * arbitrary points inside [0,1] — nothing about the Game Kernel cares
 * what image these would point at; real map images/targets are a
 * Content Studio concern (src/domain/content/geoMapping.ts), never
 * baked into this engine.
 *
 * `imageUrl` MUST be a file that genuinely exists under public/images/
 * maps — this is what `game.start` actually snapshots into a live
 * SessionGame when the Host picks "Default GeoGuessr" (no playlist
 * selected), so a placeholder path here is a REAL broken map on
 * Player/Host/Display, not just an unused fixture. (Confirmed: an
 * earlier version pointed at "sample-1.jpg"/"sample-2.jpg", which never
 * existed on disk — the exact bug this comment now guards against.)
 * Reuses the one bundled seed asset (see src/server/content/
 * geoAssets.ts) at two different target points rather than inventing a
 * second file that also has to be kept real. `sample-world-map.png` is
 * an original, procedurally-generated stylised map
 * (scripts/gen-sample-map.py) — no third-party/game art ships with this
 * repo.
 */
export const sampleGeoPlaylist: GeoGuessrConfig = {
  rounds: [
    { id: "round-1", imageUrl: "/images/maps/sample-world-map.png", question: "Where is the capital city?", targetX: 0.5, targetY: 0.5, title: "Round 1" },
    { id: "round-2", imageUrl: "/images/maps/sample-world-map.png", question: "Where is the southern port?", targetX: 0.25, targetY: 0.75, title: "Round 2" },
  ],
};
