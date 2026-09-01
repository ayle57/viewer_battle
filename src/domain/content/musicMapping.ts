import type { MusicConfig, MusicRoundConfig } from "@/domain/game/music";

/**
 * Pure input shape for the mapping below — deliberately NOT Prisma's
 * generated row type (src/domain must stay Prisma-free, see AGENTS.md
 * "Folder boundaries"). src/server/db/contentMusic.ts shapes its Prisma
 * query results into this before calling in here. Same reasoning as
 * geoMapping.ts's ContentRoundInput.
 */
export interface ContentTrackInput {
  id: string;
  audioUrl: string | null;
  title: string | null;
  artist: string | null;
}

/**
 * Turns a prepared, already-ready playlist's tracks into exactly the
 * config shape MusicEngine.createInitialState expects — the ONE place
 * Content Studio's Music data crosses into Game Kernel data, same role
 * as geoMapping.ts's playlistToGeoGuessrConfig plays for GeoGuessr. Pure
 * and total over READY input: every track here is assumed already
 * readiness-checked (getMusicPlaylistReadiness(...).ready — the
 * caller's job, same as playlistToGeoGuessrConfig's caller checks
 * getGeoPlaylistReadiness first) — `audioUrl`/`title` being non-null is
 * what that check already guaranteed, so this throws (rather than
 * silently coercing) if handed an incomplete track, the same
 * "genuinely shouldn't happen, fail loud if it does" posture
 * musicConfigSchema's own `.parse()` has inside
 * MusicEngine.createInitialState.
 *
 * Same "snapshot, not a live reference" guarantee as every other mapping
 * in this app — the RESULT of this function is what gets copied into
 * SessionGame.internalState; nothing downstream keeps a pointer back to
 * the Playlist/PlaylistTrack rows, so an edit made after this call can
 * never reach a game already started.
 */
export function playlistToMusicConfig(tracks: ContentTrackInput[]): MusicConfig {
  const rounds: MusicRoundConfig[] = tracks.map((track) => {
    if (!track.audioUrl || !track.title) {
      throw new Error(`Track "${track.id}" is not complete (missing audio or title) — check readiness before mapping.`);
    }
    return {
      id: track.id,
      audioUrl: track.audioUrl,
      title: track.title,
      artist: track.artist ?? undefined,
    };
  });
  return { rounds };
}
