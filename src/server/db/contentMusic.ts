import { ContentError, getMusicPlaylistReadiness } from "@/domain/content";
import type { MusicPlaylistReadiness } from "@/domain/content";
import { prisma } from "@/server/db/client";
import type { Prisma } from "@/generated/prisma/client";

/**
 * All Music ("Guess the Music") Content Studio persistence —
 * Playlist/PlaylistTrack CRUD, always scoped to a `hostId` resolved from
 * the SAME ContentHost bearer token content.ts's Jeopardy procedures /
 * contentGeo.ts's GeoGuessr procedures / contentDrawing.ts's Drawing
 * procedures use (one Content Studio identity for every game — see
 * prisma/schema.prisma's ContentHost comment). A deliberately SEPARATE,
 * self-contained module, same reasoning as contentDrawing.ts's own doc
 * comment: Music's flat track list (audio + title + optional artist)
 * genuinely doesn't fit any other game's summary shape, and duplicating
 * a handful of small, independently-testable queries here carries zero
 * risk of changing another game's tested behavior.
 *
 * Same IDOR-safe shape as content.ts/contentGeo.ts/contentDrawing.ts
 * throughout: every query filters ownership directly IN the query
 * (never "fetch by id, then compare a field"), so a row belonging to a
 * different host is indistinguishable from one that doesn't exist.
 */

const MUSIC_PLAYLIST_INCLUDE = {
  tracks: { orderBy: { position: "asc" } },
} satisfies Prisma.PlaylistInclude;

export interface MusicPlaylistSummary {
  id: string;
  name: string;
  description: string | null;
  gameKey: string;
  trackCount: number;
  readiness: MusicPlaylistReadiness;
  createdAt: Date;
  updatedAt: Date;
}

function toMusicSummary(playlist: Prisma.PlaylistGetPayload<{ include: typeof MUSIC_PLAYLIST_INCLUDE }>): MusicPlaylistSummary {
  const readiness = getMusicPlaylistReadiness(playlist.tracks);
  return {
    id: playlist.id,
    name: playlist.name,
    description: playlist.description,
    gameKey: playlist.gameKey,
    trackCount: readiness.trackCount,
    readiness,
    createdAt: playlist.createdAt,
    updatedAt: playlist.updatedAt,
  };
}

export async function listMusicPlaylists(hostId: string, gameKey: string): Promise<MusicPlaylistSummary[]> {
  const playlists = await prisma.playlist.findMany({
    where: { hostId, gameKey },
    orderBy: { updatedAt: "desc" },
    include: MUSIC_PLAYLIST_INCLUDE,
  });
  return playlists.map(toMusicSummary);
}

export async function createMusicPlaylist(hostId: string, gameKey: string, name: string, description?: string): Promise<MusicPlaylistSummary> {
  const trimmed = name.trim();
  if (!trimmed) throw new ContentError("VALIDATION", "Playlist name can't be empty.");
  const playlist = await prisma.playlist.create({
    data: { hostId, gameKey, name: trimmed, description: description?.trim() || null },
    include: MUSIC_PLAYLIST_INCLUDE,
  });
  return toMusicSummary(playlist);
}

export type MusicPlaylistDetail = Prisma.PlaylistGetPayload<{ include: typeof MUSIC_PLAYLIST_INCLUDE }>;

export async function getOwnedMusicPlaylist(hostId: string, playlistId: string): Promise<MusicPlaylistDetail> {
  const playlist = await prisma.playlist.findFirst({ where: { id: playlistId, hostId }, include: MUSIC_PLAYLIST_INCLUDE });
  if (!playlist) throw new ContentError("PLAYLIST_NOT_FOUND");
  return playlist;
}

export async function updateMusicPlaylist(
  hostId: string,
  playlistId: string,
  data: { name?: string; description?: string | null },
): Promise<MusicPlaylistSummary> {
  await getOwnedMusicPlaylist(hostId, playlistId); // throws PLAYLIST_NOT_FOUND if not owned
  const name = data.name !== undefined ? data.name.trim() : undefined;
  if (name !== undefined && !name) throw new ContentError("VALIDATION", "Playlist name can't be empty.");
  const playlist = await prisma.playlist.update({
    where: { id: playlistId },
    data: { name, description: data.description !== undefined ? data.description?.trim() || null : undefined },
    include: MUSIC_PLAYLIST_INCLUDE,
  });
  return toMusicSummary(playlist);
}

export async function deleteMusicPlaylist(hostId: string, playlistId: string): Promise<void> {
  await getOwnedMusicPlaylist(hostId, playlistId);
  await prisma.playlist.delete({ where: { id: playlistId } }); // cascades tracks
}

/**
 * Copies playlist + every track's audioUrl STRING (not the underlying
 * file) into a brand-new row — same "shared pool, a track just points
 * INTO it" posture as contentGeo.ts's duplicateGeoPlaylist re: images.
 */
export async function duplicateMusicPlaylist(hostId: string, playlistId: string): Promise<MusicPlaylistSummary> {
  const source = await getOwnedMusicPlaylist(hostId, playlistId);
  const created = await prisma.$transaction(async (tx) => {
    const copy = await tx.playlist.create({
      data: { hostId, gameKey: source.gameKey, name: `${source.name} (Copy)`, description: source.description },
    });
    if (source.tracks.length > 0) {
      await tx.playlistTrack.createMany({
        data: source.tracks.map((t) => ({
          playlistId: copy.id,
          position: t.position,
          audioUrl: t.audioUrl,
          title: t.title,
          artist: t.artist,
        })),
      });
    }
    return tx.playlist.findUniqueOrThrow({ where: { id: copy.id }, include: MUSIC_PLAYLIST_INCLUDE });
  });
  return toMusicSummary(created);
}

async function touchPlaylist(tx: Prisma.TransactionClient, playlistId: string): Promise<void> {
  await tx.playlist.update({ where: { id: playlistId }, data: { updatedAt: new Date() } });
}

// --- Tracks ---

async function getOwnedTrack(hostId: string, trackId: string) {
  const track = await prisma.playlistTrack.findFirst({ where: { id: trackId, playlist: { hostId } } });
  if (!track) throw new ContentError("TRACK_NOT_FOUND");
  return track;
}

/** A track starts as an empty shell — audio/title are added by updateTrack, same "exists but incomplete" shape as PlaylistRound before its image/target are set. */
export async function createTrack(hostId: string, playlistId: string, title?: string) {
  await getOwnedMusicPlaylist(hostId, playlistId);
  return prisma.$transaction(async (tx) => {
    const count = await tx.playlistTrack.count({ where: { playlistId } });
    const track = await tx.playlistTrack.create({
      data: { playlistId, position: count, title: title?.trim() || null },
    });
    await touchPlaylist(tx, playlistId);
    return track;
  });
}

export interface TrackInput {
  audioUrl?: string | null;
  title?: string | null;
  artist?: string | null;
}

function validateTrackInput(input: TrackInput) {
  if (input.audioUrl !== undefined && input.audioUrl !== null && !input.audioUrl.trim()) {
    throw new ContentError("VALIDATION", "Audio clip can't be blank.");
  }
  if (input.title !== undefined && input.title !== null && !input.title.trim()) {
    throw new ContentError("VALIDATION", "Title can't be blank.");
  }
  if (input.artist !== undefined && input.artist !== null && !input.artist.trim()) {
    throw new ContentError("VALIDATION", "Artist can't be blank — leave it unset instead if there isn't one.");
  }
}

export async function updateTrack(hostId: string, trackId: string, input: TrackInput) {
  validateTrackInput(input);
  const track = await getOwnedTrack(hostId, trackId);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.playlistTrack.update({
      where: { id: track.id },
      data: {
        audioUrl: input.audioUrl !== undefined ? input.audioUrl?.trim() || null : undefined,
        title: input.title !== undefined ? input.title?.trim() || null : undefined,
        artist: input.artist !== undefined ? input.artist?.trim() || null : undefined,
      },
    });
    await touchPlaylist(tx, track.playlistId);
    return updated;
  });
}

/**
 * Copies one track — audio reference, title, AND artist — into a
 * brand-new row at the end of the SAME playlist, same shape as
 * contentGeo.ts's `duplicateRound`. Safe to just copy the `audioUrl`
 * STRING rather than the underlying file, same reasoning as that
 * function's own doc comment. The original track is never touched —
 * this only ever creates a new row.
 */
export async function duplicateTrack(hostId: string, trackId: string) {
  const source = await getOwnedTrack(hostId, trackId);
  return prisma.$transaction(async (tx) => {
    const count = await tx.playlistTrack.count({ where: { playlistId: source.playlistId } });
    const copy = await tx.playlistTrack.create({
      data: {
        playlistId: source.playlistId,
        position: count,
        title: source.title ? `${source.title} (Copy)` : null,
        audioUrl: source.audioUrl,
        artist: source.artist,
      },
    });
    await touchPlaylist(tx, source.playlistId);
    return copy;
  });
}

export async function deleteTrack(hostId: string, trackId: string): Promise<void> {
  const track = await getOwnedTrack(hostId, trackId);
  await prisma.$transaction(async (tx) => {
    await tx.playlistTrack.delete({ where: { id: track.id } });
    await touchPlaylist(tx, track.playlistId);
  });
}

export async function reorderTracks(hostId: string, playlistId: string, orderedTrackIds: string[]): Promise<void> {
  const playlist = await getOwnedMusicPlaylist(hostId, playlistId);
  const existingIds = new Set(playlist.tracks.map((t) => t.id));
  if (orderedTrackIds.length !== existingIds.size || orderedTrackIds.some((id) => !existingIds.has(id))) {
    throw new ContentError("VALIDATION", "Reorder list must match this playlist's tracks exactly.");
  }
  await prisma.$transaction([
    ...orderedTrackIds.map((id, position) => prisma.playlistTrack.update({ where: { id }, data: { position } })),
    prisma.playlist.update({ where: { id: playlistId }, data: { updatedAt: new Date() } }),
  ]);
}

/** Whether ANY session currently has an in-progress game snapshotted from this playlist — same "informational, never gates editing" purpose as content.ts's isPlaylistInUse / contentGeo.ts's isGeoPlaylistInUse. */
export async function isMusicPlaylistInUse(playlistId: string): Promise<boolean> {
  const live = await prisma.sessionGame.findFirst({ where: { playlistId, status: "IN_PROGRESS" }, select: { id: true } });
  return live !== null;
}
