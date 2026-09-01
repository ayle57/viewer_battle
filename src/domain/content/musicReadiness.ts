/**
 * "Is this Guess-the-Music playlist actually ready to play" — the Music
 * counterpart to geoReadiness.ts's `getGeoPlaylistReadiness`, computed
 * the same way (one pure, testable, server+client-shared function) but
 * over Music's own content shape: a flat list of TRACKS, each complete
 * iff it has an uploaded clip AND a title (`artist` is always optional —
 * see src/domain/game/music/types.ts's musicRoundSchema). Same status
 * vocabulary (`empty`/`incomplete`/`ready`) and the same shape of
 * guarantee: every surface that needs to know "can the Host start this"
 * (the track list, the Host lobby's content picker, game.start's
 * server-side refusal) calls this one function, never re-derives it.
 *
 * No fixed "must have exactly N tracks" floor beyond "at least one
 * complete track" — same posture as GeoGuessr's own readiness: MusicEngine
 * is correct for any positive round count, gracefully ending the game
 * (leading score wins, "TIE" if level) if fewer than MUSIC_WIN_THRESHOLD
 * tracks are configured. A real show would configure many more — that's
 * a product recommendation, not a rule this function enforces.
 */

export interface TrackCompletenessInput {
  audioUrl: string | null;
  title: string | null;
}

export function isTrackComplete(track: TrackCompletenessInput): boolean {
  return Boolean(track.audioUrl) && Boolean(track.title);
}

export interface TrackReadinessInput extends TrackCompletenessInput {
  id: string;
}

/** One incomplete track, for callers that want to point the Host at exactly what's missing (the track list's own status glyph — same spirit as geoReadiness.ts's IncompleteRound). */
export interface IncompleteTrack {
  trackId: string;
  missingAudio: boolean;
  missingTitle: boolean;
}

export type MusicPlaylistReadinessStatus = "empty" | "incomplete" | "ready";

export interface MusicPlaylistReadiness {
  status: MusicPlaylistReadinessStatus;
  ready: boolean;
  trackCount: number;
  completeTrackCount: number;
  incompleteTracks: IncompleteTrack[];
  /** The first incomplete track's id, in list order — `null` once ready. Same "go straight to the first problem" purpose as geoReadiness.ts's `firstProblemRoundId`. */
  firstProblemTrackId: string | null;
  /** One human-readable line, built from the SAME data as the rest of this object. */
  summary: string;
}

function buildSummary(status: MusicPlaylistReadinessStatus, incompleteTracks: IncompleteTrack[]): string {
  if (status === "empty") return "Add a track to get started.";
  if (status === "ready") return "Ready to play.";
  const count = incompleteTracks.length;
  return `${count} track${count === 1 ? "" : "s"} ${count === 1 ? "is" : "are"} missing a clip or a title.`;
}

/**
 * The one place a Music Playlist's readiness gets computed — every
 * caller (server: contentMusicRouter's list/get, game.start's refusal
 * check; client: instant local recompute in the track editor) calls
 * this same function over the same shape.
 */
export function getMusicPlaylistReadiness(tracks: TrackReadinessInput[]): MusicPlaylistReadiness {
  if (tracks.length === 0) {
    return {
      status: "empty",
      ready: false,
      trackCount: 0,
      completeTrackCount: 0,
      incompleteTracks: [],
      firstProblemTrackId: null,
      summary: buildSummary("empty", []),
    };
  }

  const incompleteTracks: IncompleteTrack[] = [];
  let completeTrackCount = 0;
  for (const track of tracks) {
    const missingAudio = !track.audioUrl;
    const missingTitle = !track.title;
    if (!missingAudio && !missingTitle) {
      completeTrackCount += 1;
      continue;
    }
    incompleteTracks.push({ trackId: track.id, missingAudio, missingTitle });
  }

  const status: MusicPlaylistReadinessStatus = incompleteTracks.length === 0 ? "ready" : "incomplete";
  return {
    status,
    ready: status === "ready",
    trackCount: tracks.length,
    completeTrackCount,
    incompleteTracks,
    firstProblemTrackId: incompleteTracks[0]?.trackId ?? null,
    summary: buildSummary(status, incompleteTracks),
  };
}
