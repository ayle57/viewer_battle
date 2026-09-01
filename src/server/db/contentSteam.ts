import { ContentError, getSteamRatingsPlaylistReadiness } from "@/domain/content";
import type { SteamRatingsPlaylistReadiness } from "@/domain/content";
import { prisma } from "@/server/db/client";
import type { Prisma } from "@/generated/prisma/client";

/**
 * All "Guess the Game" (Steam Ratings) Content Studio persistence —
 * Playlist/PlaylistSteamGame CRUD, always scoped to a `hostId` resolved
 * from the SAME ContentHost bearer token content.ts's Jeopardy
 * procedures / contentGeo.ts's/contentDrawing.ts's/contentMusic.ts's own
 * procedures use (one Content Studio identity for every game — see
 * prisma/schema.prisma's ContentHost comment). A deliberately SEPARATE,
 * self-contained module, same reasoning as contentMusic.ts's own doc
 * comment: this game's flat game list (title + cover image + an ordered
 * ratings array) genuinely doesn't fit any other game's summary shape,
 * and duplicating a handful of small, independently-testable queries
 * here carries zero risk of changing another game's tested behavior.
 *
 * Same IDOR-safe shape as content.ts/contentGeo.ts/contentDrawing.ts/
 * contentMusic.ts throughout: every query filters ownership directly IN
 * the query (never "fetch by id, then compare a field"), so a row
 * belonging to a different host is indistinguishable from one that
 * doesn't exist.
 */

const STEAM_PLAYLIST_INCLUDE = {
  steamGames: { orderBy: { position: "asc" } },
} satisfies Prisma.PlaylistInclude;

export interface SteamPlaylistSummary {
  id: string;
  name: string;
  description: string | null;
  gameKey: string;
  gameCount: number;
  readiness: SteamRatingsPlaylistReadiness;
  createdAt: Date;
  updatedAt: Date;
}

function toSteamSummary(playlist: Prisma.PlaylistGetPayload<{ include: typeof STEAM_PLAYLIST_INCLUDE }>): SteamPlaylistSummary {
  const readiness = getSteamRatingsPlaylistReadiness(playlist.steamGames);
  return {
    id: playlist.id,
    name: playlist.name,
    description: playlist.description,
    gameKey: playlist.gameKey,
    gameCount: readiness.gameCount,
    readiness,
    createdAt: playlist.createdAt,
    updatedAt: playlist.updatedAt,
  };
}

export async function listSteamPlaylists(hostId: string, gameKey: string): Promise<SteamPlaylistSummary[]> {
  const playlists = await prisma.playlist.findMany({
    where: { hostId, gameKey },
    orderBy: { updatedAt: "desc" },
    include: STEAM_PLAYLIST_INCLUDE,
  });
  return playlists.map(toSteamSummary);
}

export async function createSteamPlaylist(hostId: string, gameKey: string, name: string, description?: string): Promise<SteamPlaylistSummary> {
  const trimmed = name.trim();
  if (!trimmed) throw new ContentError("VALIDATION", "Playlist name can't be empty.");
  const playlist = await prisma.playlist.create({
    data: { hostId, gameKey, name: trimmed, description: description?.trim() || null },
    include: STEAM_PLAYLIST_INCLUDE,
  });
  return toSteamSummary(playlist);
}

export type SteamPlaylistDetail = Prisma.PlaylistGetPayload<{ include: typeof STEAM_PLAYLIST_INCLUDE }>;

export async function getOwnedSteamPlaylist(hostId: string, playlistId: string): Promise<SteamPlaylistDetail> {
  const playlist = await prisma.playlist.findFirst({ where: { id: playlistId, hostId }, include: STEAM_PLAYLIST_INCLUDE });
  if (!playlist) throw new ContentError("PLAYLIST_NOT_FOUND");
  return playlist;
}

export async function updateSteamPlaylist(
  hostId: string,
  playlistId: string,
  data: { name?: string; description?: string | null },
): Promise<SteamPlaylistSummary> {
  await getOwnedSteamPlaylist(hostId, playlistId); // throws PLAYLIST_NOT_FOUND if not owned
  const name = data.name !== undefined ? data.name.trim() : undefined;
  if (name !== undefined && !name) throw new ContentError("VALIDATION", "Playlist name can't be empty.");
  const playlist = await prisma.playlist.update({
    where: { id: playlistId },
    data: { name, description: data.description !== undefined ? data.description?.trim() || null : undefined },
    include: STEAM_PLAYLIST_INCLUDE,
  });
  return toSteamSummary(playlist);
}

export async function deleteSteamPlaylist(hostId: string, playlistId: string): Promise<void> {
  await getOwnedSteamPlaylist(hostId, playlistId);
  await prisma.playlist.delete({ where: { id: playlistId } }); // cascades steam games
}

/**
 * Copies playlist + every game's title/imageUrl STRING (not the
 * underlying file) and its full `ratings` array into a brand-new row —
 * same "shared pool, a game just points INTO it" posture as
 * contentMusic.ts's duplicateMusicPlaylist re: audio clips.
 */
export async function duplicateSteamPlaylist(hostId: string, playlistId: string): Promise<SteamPlaylistSummary> {
  const source = await getOwnedSteamPlaylist(hostId, playlistId);
  const created = await prisma.$transaction(async (tx) => {
    const copy = await tx.playlist.create({
      data: { hostId, gameKey: source.gameKey, name: `${source.name} (Copy)`, description: source.description },
    });
    if (source.steamGames.length > 0) {
      await tx.playlistSteamGame.createMany({
        data: source.steamGames.map((g) => ({
          playlistId: copy.id,
          position: g.position,
          title: g.title,
          imageUrl: g.imageUrl,
          ratings: g.ratings,
        })),
      });
    }
    return tx.playlist.findUniqueOrThrow({ where: { id: copy.id }, include: STEAM_PLAYLIST_INCLUDE });
  });
  return toSteamSummary(created);
}

async function touchPlaylist(tx: Prisma.TransactionClient, playlistId: string): Promise<void> {
  await tx.playlist.update({ where: { id: playlistId }, data: { updatedAt: new Date() } });
}

// --- Games ---

async function getOwnedGame(hostId: string, gameId: string) {
  const game = await prisma.playlistSteamGame.findFirst({ where: { id: gameId, playlist: { hostId } } });
  if (!game) throw new ContentError("STEAM_GAME_NOT_FOUND");
  return game;
}

/** A game starts as an empty shell — title/image/ratings are added by updateGame, same "exists but incomplete" shape as PlaylistTrack before its audio/title are set. */
export async function createSteamGame(hostId: string, playlistId: string, title?: string) {
  await getOwnedSteamPlaylist(hostId, playlistId);
  return prisma.$transaction(async (tx) => {
    const count = await tx.playlistSteamGame.count({ where: { playlistId } });
    const game = await tx.playlistSteamGame.create({
      data: { playlistId, position: count, title: title?.trim() || null },
    });
    await touchPlaylist(tx, playlistId);
    return game;
  });
}

export interface SteamGameInput {
  title?: string | null;
  imageUrl?: string | null;
  ratings?: string[];
}

const MAX_RATINGS_PER_GAME = 10;

function validateSteamGameInput(input: SteamGameInput) {
  if (input.title !== undefined && input.title !== null && !input.title.trim()) {
    throw new ContentError("VALIDATION", "Title can't be blank.");
  }
  if (input.imageUrl !== undefined && input.imageUrl !== null && !input.imageUrl.trim()) {
    throw new ContentError("VALIDATION", "Cover image can't be blank.");
  }
  if (input.ratings !== undefined) {
    if (input.ratings.length > MAX_RATINGS_PER_GAME) {
      throw new ContentError("VALIDATION", `A game can have at most ${MAX_RATINGS_PER_GAME} ratings.`);
    }
    if (input.ratings.some((r) => !r.trim())) {
      throw new ContentError("VALIDATION", "A rating can't be blank — remove the empty one instead.");
    }
  }
}

export async function updateSteamGame(hostId: string, gameId: string, input: SteamGameInput) {
  validateSteamGameInput(input);
  const game = await getOwnedGame(hostId, gameId);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.playlistSteamGame.update({
      where: { id: game.id },
      data: {
        title: input.title !== undefined ? input.title?.trim() || null : undefined,
        imageUrl: input.imageUrl !== undefined ? input.imageUrl?.trim() || null : undefined,
        ratings: input.ratings !== undefined ? input.ratings.map((r) => r.trim()) : undefined,
      },
    });
    await touchPlaylist(tx, game.playlistId);
    return updated;
  });
}

/**
 * Copies one game — title, cover image reference, AND its full ratings
 * array — into a brand-new row at the end of the SAME playlist, same
 * shape as contentMusic.ts's `duplicateTrack`. Safe to just copy the
 * `imageUrl` STRING rather than the underlying file, same reasoning as
 * that function's own doc comment. The original game is never touched —
 * this only ever creates a new row.
 */
export async function duplicateSteamGame(hostId: string, gameId: string) {
  const source = await getOwnedGame(hostId, gameId);
  return prisma.$transaction(async (tx) => {
    const count = await tx.playlistSteamGame.count({ where: { playlistId: source.playlistId } });
    const copy = await tx.playlistSteamGame.create({
      data: {
        playlistId: source.playlistId,
        position: count,
        title: source.title ? `${source.title} (Copy)` : null,
        imageUrl: source.imageUrl,
        ratings: source.ratings,
      },
    });
    await touchPlaylist(tx, source.playlistId);
    return copy;
  });
}

export async function deleteSteamGame(hostId: string, gameId: string): Promise<void> {
  const game = await getOwnedGame(hostId, gameId);
  await prisma.$transaction(async (tx) => {
    await tx.playlistSteamGame.delete({ where: { id: game.id } });
    await touchPlaylist(tx, game.playlistId);
  });
}

export async function reorderSteamGames(hostId: string, playlistId: string, orderedGameIds: string[]): Promise<void> {
  const playlist = await getOwnedSteamPlaylist(hostId, playlistId);
  const existingIds = new Set(playlist.steamGames.map((g) => g.id));
  if (orderedGameIds.length !== existingIds.size || orderedGameIds.some((id) => !existingIds.has(id))) {
    throw new ContentError("VALIDATION", "Reorder list must match this playlist's games exactly.");
  }
  await prisma.$transaction([
    ...orderedGameIds.map((id, position) => prisma.playlistSteamGame.update({ where: { id }, data: { position } })),
    prisma.playlist.update({ where: { id: playlistId }, data: { updatedAt: new Date() } }),
  ]);
}

/** Whether ANY session currently has an in-progress game snapshotted from this playlist — same "informational, never gates editing" purpose as content.ts's isPlaylistInUse / contentMusic.ts's isMusicPlaylistInUse. */
export async function isSteamPlaylistInUse(playlistId: string): Promise<boolean> {
  const live = await prisma.sessionGame.findFirst({ where: { playlistId, status: "IN_PROGRESS" }, select: { id: true } });
  return live !== null;
}
