import { ContentError, getGuessThePricePlaylistReadiness } from "@/domain/content";
import type { GuessThePricePlaylistReadiness } from "@/domain/content";
import { prisma } from "@/server/db/client";
import type { Prisma } from "@/generated/prisma/client";

/**
 * All "Guess the Price" Content Studio persistence — Playlist/
 * PlaylistPriceItem CRUD, always scoped to a `hostId` resolved from the
 * SAME ContentHost bearer token content.ts's Jeopardy procedures /
 * contentGeo.ts's/contentDrawing.ts's/contentMusic.ts's/contentSteam.ts's
 * own procedures use (one Content Studio identity for every game — see
 * prisma/schema.prisma's ContentHost comment). A deliberately SEPARATE,
 * self-contained module, same reasoning as contentSteam.ts's own doc
 * comment: this game's flat item list (title + photo + price + optional
 * margin) genuinely doesn't fit any other game's summary shape, and
 * duplicating a handful of small, independently-testable queries here
 * carries zero risk of changing another game's tested behavior.
 *
 * Same IDOR-safe shape as content.ts/contentGeo.ts/contentDrawing.ts/
 * contentMusic.ts/contentSteam.ts throughout: every query filters
 * ownership directly IN the query (never "fetch by id, then compare a
 * field"), so a row belonging to a different host is indistinguishable
 * from one that doesn't exist.
 */

const PRICE_PLAYLIST_INCLUDE = {
  priceItems: { orderBy: { position: "asc" } },
} satisfies Prisma.PlaylistInclude;

export interface PricePlaylistSummary {
  id: string;
  name: string;
  description: string | null;
  gameKey: string;
  itemCount: number;
  readiness: GuessThePricePlaylistReadiness;
  createdAt: Date;
  updatedAt: Date;
}

function toPriceSummary(playlist: Prisma.PlaylistGetPayload<{ include: typeof PRICE_PLAYLIST_INCLUDE }>): PricePlaylistSummary {
  const readiness = getGuessThePricePlaylistReadiness(playlist.priceItems);
  return {
    id: playlist.id,
    name: playlist.name,
    description: playlist.description,
    gameKey: playlist.gameKey,
    itemCount: readiness.itemCount,
    readiness,
    createdAt: playlist.createdAt,
    updatedAt: playlist.updatedAt,
  };
}

export async function listPricePlaylists(hostId: string, gameKey: string): Promise<PricePlaylistSummary[]> {
  const playlists = await prisma.playlist.findMany({
    where: { hostId, gameKey },
    orderBy: { updatedAt: "desc" },
    include: PRICE_PLAYLIST_INCLUDE,
  });
  return playlists.map(toPriceSummary);
}

export async function createPricePlaylist(hostId: string, gameKey: string, name: string, description?: string): Promise<PricePlaylistSummary> {
  const trimmed = name.trim();
  if (!trimmed) throw new ContentError("VALIDATION", "Playlist name can't be empty.");
  const playlist = await prisma.playlist.create({
    data: { hostId, gameKey, name: trimmed, description: description?.trim() || null },
    include: PRICE_PLAYLIST_INCLUDE,
  });
  return toPriceSummary(playlist);
}

export type PricePlaylistDetail = Prisma.PlaylistGetPayload<{ include: typeof PRICE_PLAYLIST_INCLUDE }>;

export async function getOwnedPricePlaylist(hostId: string, playlistId: string): Promise<PricePlaylistDetail> {
  const playlist = await prisma.playlist.findFirst({ where: { id: playlistId, hostId }, include: PRICE_PLAYLIST_INCLUDE });
  if (!playlist) throw new ContentError("PLAYLIST_NOT_FOUND");
  return playlist;
}

export async function updatePricePlaylist(
  hostId: string,
  playlistId: string,
  data: { name?: string; description?: string | null },
): Promise<PricePlaylistSummary> {
  await getOwnedPricePlaylist(hostId, playlistId); // throws PLAYLIST_NOT_FOUND if not owned
  const name = data.name !== undefined ? data.name.trim() : undefined;
  if (name !== undefined && !name) throw new ContentError("VALIDATION", "Playlist name can't be empty.");
  const playlist = await prisma.playlist.update({
    where: { id: playlistId },
    data: { name, description: data.description !== undefined ? data.description?.trim() || null : undefined },
    include: PRICE_PLAYLIST_INCLUDE,
  });
  return toPriceSummary(playlist);
}

export async function deletePricePlaylist(hostId: string, playlistId: string): Promise<void> {
  await getOwnedPricePlaylist(hostId, playlistId);
  await prisma.playlist.delete({ where: { id: playlistId } }); // cascades price items
}

/**
 * Copies playlist + every item's title/imageUrl/price/marginPercent into
 * a brand-new row — same "shared pool, an item just points INTO it"
 * posture as contentSteam.ts's duplicateSteamPlaylist re: cover images.
 */
export async function duplicatePricePlaylist(hostId: string, playlistId: string): Promise<PricePlaylistSummary> {
  const source = await getOwnedPricePlaylist(hostId, playlistId);
  const created = await prisma.$transaction(async (tx) => {
    const copy = await tx.playlist.create({
      data: { hostId, gameKey: source.gameKey, name: `${source.name} (Copy)`, description: source.description },
    });
    if (source.priceItems.length > 0) {
      await tx.playlistPriceItem.createMany({
        data: source.priceItems.map((item) => ({
          playlistId: copy.id,
          position: item.position,
          title: item.title,
          imageUrl: item.imageUrl,
          price: item.price,
          marginPercent: item.marginPercent,
        })),
      });
    }
    return tx.playlist.findUniqueOrThrow({ where: { id: copy.id }, include: PRICE_PLAYLIST_INCLUDE });
  });
  return toPriceSummary(created);
}

async function touchPlaylist(tx: Prisma.TransactionClient, playlistId: string): Promise<void> {
  await tx.playlist.update({ where: { id: playlistId }, data: { updatedAt: new Date() } });
}

// --- Items ---

async function getOwnedItem(hostId: string, itemId: string) {
  const item = await prisma.playlistPriceItem.findFirst({ where: { id: itemId, playlist: { hostId } } });
  if (!item) throw new ContentError("PRICE_ITEM_NOT_FOUND");
  return item;
}

/** An item starts as an empty shell — title/image/price are added by updateItem, same "exists but incomplete" shape as PlaylistSteamGame before its title/cover/ratings are set. */
export async function createPriceItem(hostId: string, playlistId: string, title?: string) {
  await getOwnedPricePlaylist(hostId, playlistId);
  return prisma.$transaction(async (tx) => {
    const count = await tx.playlistPriceItem.count({ where: { playlistId } });
    const item = await tx.playlistPriceItem.create({
      data: { playlistId, position: count, title: title?.trim() || null },
    });
    await touchPlaylist(tx, playlistId);
    return item;
  });
}

export interface PriceItemInput {
  title?: string | null;
  imageUrl?: string | null;
  price?: number | null;
  marginPercent?: number | null;
}

function validatePriceItemInput(input: PriceItemInput) {
  if (input.title !== undefined && input.title !== null && !input.title.trim()) {
    throw new ContentError("VALIDATION", "Title can't be blank.");
  }
  if (input.imageUrl !== undefined && input.imageUrl !== null && !input.imageUrl.trim()) {
    throw new ContentError("VALIDATION", "Photo can't be blank.");
  }
  if (input.price !== undefined && input.price !== null && !(input.price > 0)) {
    throw new ContentError("VALIDATION", "Price must be a positive number.");
  }
  if (input.marginPercent !== undefined && input.marginPercent !== null && (input.marginPercent < 0 || input.marginPercent > 100)) {
    throw new ContentError("VALIDATION", "Margin must be between 0 and 100%.");
  }
}

export async function updatePriceItem(hostId: string, itemId: string, input: PriceItemInput) {
  validatePriceItemInput(input);
  const item = await getOwnedItem(hostId, itemId);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.playlistPriceItem.update({
      where: { id: item.id },
      data: {
        title: input.title !== undefined ? input.title?.trim() || null : undefined,
        imageUrl: input.imageUrl !== undefined ? input.imageUrl?.trim() || null : undefined,
        price: input.price !== undefined ? input.price : undefined,
        marginPercent: input.marginPercent !== undefined ? input.marginPercent : undefined,
      },
    });
    await touchPlaylist(tx, item.playlistId);
    return updated;
  });
}

/**
 * Copies one item — title, photo reference, price, AND margin — into a
 * brand-new row at the end of the SAME playlist, same shape as
 * contentSteam.ts's `duplicateSteamGame`. Safe to just copy the
 * `imageUrl` STRING rather than the underlying file, same reasoning as
 * that function's own doc comment. The original item is never touched —
 * this only ever creates a new row.
 */
export async function duplicatePriceItem(hostId: string, itemId: string) {
  const source = await getOwnedItem(hostId, itemId);
  return prisma.$transaction(async (tx) => {
    const count = await tx.playlistPriceItem.count({ where: { playlistId: source.playlistId } });
    const copy = await tx.playlistPriceItem.create({
      data: {
        playlistId: source.playlistId,
        position: count,
        title: source.title ? `${source.title} (Copy)` : null,
        imageUrl: source.imageUrl,
        price: source.price,
        marginPercent: source.marginPercent,
      },
    });
    await touchPlaylist(tx, source.playlistId);
    return copy;
  });
}

export async function deletePriceItem(hostId: string, itemId: string): Promise<void> {
  const item = await getOwnedItem(hostId, itemId);
  await prisma.$transaction(async (tx) => {
    await tx.playlistPriceItem.delete({ where: { id: item.id } });
    await touchPlaylist(tx, item.playlistId);
  });
}

export async function reorderPriceItems(hostId: string, playlistId: string, orderedItemIds: string[]): Promise<void> {
  const playlist = await getOwnedPricePlaylist(hostId, playlistId);
  const existingIds = new Set(playlist.priceItems.map((item) => item.id));
  if (orderedItemIds.length !== existingIds.size || orderedItemIds.some((id) => !existingIds.has(id))) {
    throw new ContentError("VALIDATION", "Reorder list must match this playlist's items exactly.");
  }
  await prisma.$transaction([
    ...orderedItemIds.map((id, position) => prisma.playlistPriceItem.update({ where: { id }, data: { position } })),
    prisma.playlist.update({ where: { id: playlistId }, data: { updatedAt: new Date() } }),
  ]);
}

/** Whether ANY session currently has an in-progress game snapshotted from this playlist — same "informational, never gates editing" purpose as content.ts's isPlaylistInUse / contentSteam.ts's isSteamPlaylistInUse. */
export async function isPricePlaylistInUse(playlistId: string): Promise<boolean> {
  const live = await prisma.sessionGame.findFirst({ where: { playlistId, status: "IN_PROGRESS" }, select: { id: true } });
  return live !== null;
}
