import type { MusicConfig } from "./types";

/**
 * FIXTURE DATA — not real show content, same posture as
 * boardQuestion/fixtures.ts's sampleBoard and geoGuessr/fixtures.ts's
 * sampleGeoPlaylist. Two rounds is enough to exercise a full
 * intro -> playback -> buzz -> answer -> judge -> reveal -> next round
 * cycle (plus a steal) in engine.test.ts without a long playlist.
 *
 * `audioUrl` MUST be a file that genuinely exists under public/audio/
 * music — this is what `game.start` actually snapshots into a live
 * SessionGame when the Host picks "Default Guess the Music" (no
 * playlist selected), so a placeholder path here would be a REAL broken
 * clip on Player/Host/Display, not just an unused fixture (see
 * geoGuessr/fixtures.ts's own doc comment on the exact bug class this
 * guards against). The bundled file is a locally-generated short tone
 * (src/server/content/musicAssets.ts's seed script — no licensed track
 * ships with this repo), reused at two different "rounds" the same way
 * GeoGuessr's own sample reuses its one bundled map image twice.
 */
export const sampleMusicPlaylist: MusicConfig = {
  rounds: [
    { id: "round-1", audioUrl: "/audio/music/sample-tone.wav", title: "Sample Tone", artist: "Viewer Battle" },
    { id: "round-2", audioUrl: "/audio/music/sample-tone.wav", title: "Sample Tone (again)", artist: "Viewer Battle" },
  ],
};
