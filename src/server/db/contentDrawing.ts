import { ContentError, getDrawingPlaylistReadiness } from "@/domain/content";
import type { DrawingPlaylistReadiness } from "@/domain/content";
import { prisma } from "@/server/db/client";
import type { Prisma } from "@/generated/prisma/client";

/**
 * All Drawing Content Studio persistence — Playlist/PlaylistPrompt CRUD,
 * always scoped to a `hostId` resolved from the SAME ContentHost bearer
 * token content.ts's Jeopardy procedures / contentGeo.ts's GeoGuessr
 * procedures use (one Content Studio identity for every game — see
 * prisma/schema.prisma's ContentHost comment). A deliberately SEPARATE,
 * self-contained module, same reasoning as contentGeo.ts's own doc
 * comment: Drawing's flat prompt list genuinely doesn't fit either other
 * game's summary shape, and duplicating a handful of small,
 * independently-testable queries here carries zero risk of changing
 * Jeopardy's or GeoGuessr's tested behavior.
 *
 * Same IDOR-safe shape as content.ts/contentGeo.ts throughout: every
 * query filters ownership directly IN the query (never "fetch by id,
 * then compare a field"), so a row belonging to a different host is
 * indistinguishable from one that doesn't exist. No asset/image
 * sub-router here at all — unlike GeoGuessr, a Drawing prompt is just
 * text + a duration, no uploaded file of any kind.
 */

const DRAWING_PLAYLIST_INCLUDE = {
  prompts: { orderBy: { position: "asc" } },
} satisfies Prisma.PlaylistInclude;

export interface DrawingPlaylistSummary {
  id: string;
  name: string;
  description: string | null;
  gameKey: string;
  promptCount: number;
  readiness: DrawingPlaylistReadiness;
  createdAt: Date;
  updatedAt: Date;
}

function toDrawingSummary(playlist: Prisma.PlaylistGetPayload<{ include: typeof DRAWING_PLAYLIST_INCLUDE }>): DrawingPlaylistSummary {
  const readiness = getDrawingPlaylistReadiness(playlist.prompts);
  return {
    id: playlist.id,
    name: playlist.name,
    description: playlist.description,
    gameKey: playlist.gameKey,
    promptCount: readiness.promptCount,
    readiness,
    createdAt: playlist.createdAt,
    updatedAt: playlist.updatedAt,
  };
}

export async function listDrawingPlaylists(hostId: string, gameKey: string): Promise<DrawingPlaylistSummary[]> {
  const playlists = await prisma.playlist.findMany({
    where: { hostId, gameKey },
    orderBy: { updatedAt: "desc" },
    include: DRAWING_PLAYLIST_INCLUDE,
  });
  return playlists.map(toDrawingSummary);
}

export async function createDrawingPlaylist(hostId: string, gameKey: string, name: string, description?: string): Promise<DrawingPlaylistSummary> {
  const trimmed = name.trim();
  if (!trimmed) throw new ContentError("VALIDATION", "Playlist name can't be empty.");
  const playlist = await prisma.playlist.create({
    data: { hostId, gameKey, name: trimmed, description: description?.trim() || null },
    include: DRAWING_PLAYLIST_INCLUDE,
  });
  return toDrawingSummary(playlist);
}

export type DrawingPlaylistDetail = Prisma.PlaylistGetPayload<{ include: typeof DRAWING_PLAYLIST_INCLUDE }>;

export async function getOwnedDrawingPlaylist(hostId: string, playlistId: string): Promise<DrawingPlaylistDetail> {
  const playlist = await prisma.playlist.findFirst({ where: { id: playlistId, hostId }, include: DRAWING_PLAYLIST_INCLUDE });
  if (!playlist) throw new ContentError("PLAYLIST_NOT_FOUND");
  return playlist;
}

export async function updateDrawingPlaylist(
  hostId: string,
  playlistId: string,
  data: { name?: string; description?: string | null },
): Promise<DrawingPlaylistSummary> {
  await getOwnedDrawingPlaylist(hostId, playlistId); // throws PLAYLIST_NOT_FOUND if not owned
  const name = data.name !== undefined ? data.name.trim() : undefined;
  if (name !== undefined && !name) throw new ContentError("VALIDATION", "Playlist name can't be empty.");
  const playlist = await prisma.playlist.update({
    where: { id: playlistId },
    data: { name, description: data.description !== undefined ? data.description?.trim() || null : undefined },
    include: DRAWING_PLAYLIST_INCLUDE,
  });
  return toDrawingSummary(playlist);
}

export async function deleteDrawingPlaylist(hostId: string, playlistId: string): Promise<void> {
  await getOwnedDrawingPlaylist(hostId, playlistId);
  await prisma.playlist.delete({ where: { id: playlistId } }); // cascades prompts
}

export async function duplicateDrawingPlaylist(hostId: string, playlistId: string): Promise<DrawingPlaylistSummary> {
  const source = await getOwnedDrawingPlaylist(hostId, playlistId);
  const created = await prisma.$transaction(async (tx) => {
    const copy = await tx.playlist.create({
      data: { hostId, gameKey: source.gameKey, name: `${source.name} (Copy)`, description: source.description },
    });
    if (source.prompts.length > 0) {
      await tx.playlistPrompt.createMany({
        data: source.prompts.map((p) => ({
          playlistId: copy.id,
          position: p.position,
          text: p.text,
          durationSeconds: p.durationSeconds,
        })),
      });
    }
    return tx.playlist.findUniqueOrThrow({ where: { id: copy.id }, include: DRAWING_PLAYLIST_INCLUDE });
  });
  return toDrawingSummary(created);
}

async function touchPlaylist(tx: Prisma.TransactionClient, playlistId: string): Promise<void> {
  await tx.playlist.update({ where: { id: playlistId }, data: { updatedAt: new Date() } });
}

// --- Prompts ---

async function getOwnedPrompt(hostId: string, promptId: string) {
  const prompt = await prisma.playlistPrompt.findFirst({ where: { id: promptId, playlist: { hostId } } });
  if (!prompt) throw new ContentError("PROMPT_NOT_FOUND");
  return prompt;
}

/** A prompt starts as an empty shell — text is added by updatePrompt, same "exists but incomplete" shape as PlaylistRound before its image/target are set. */
export async function createPrompt(hostId: string, playlistId: string, text?: string) {
  await getOwnedDrawingPlaylist(hostId, playlistId);
  return prisma.$transaction(async (tx) => {
    const count = await tx.playlistPrompt.count({ where: { playlistId } });
    const prompt = await tx.playlistPrompt.create({
      data: { playlistId, position: count, text: text?.trim() || null },
    });
    await touchPlaylist(tx, playlistId);
    return prompt;
  });
}

export interface PromptInput {
  text?: string | null;
  durationSeconds?: number;
}

function validatePromptInput(input: PromptInput) {
  if (input.text !== undefined && input.text !== null && !input.text.trim()) {
    throw new ContentError("VALIDATION", "Prompt text can't be blank.");
  }
  if (input.durationSeconds !== undefined && (!Number.isInteger(input.durationSeconds) || input.durationSeconds <= 0)) {
    throw new ContentError("VALIDATION", "Duration must be a positive whole number of seconds.");
  }
}

export async function updatePrompt(hostId: string, promptId: string, input: PromptInput) {
  validatePromptInput(input);
  const prompt = await getOwnedPrompt(hostId, promptId);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.playlistPrompt.update({
      where: { id: prompt.id },
      data: {
        text: input.text !== undefined ? input.text?.trim() || null : undefined,
        durationSeconds: input.durationSeconds,
      },
    });
    await touchPlaylist(tx, prompt.playlistId);
    return updated;
  });
}

/** Copies one prompt's text and duration into a brand-new row at the end of the SAME playlist, same shape as contentGeo.ts's `duplicateRound`. The original prompt is never touched — this only ever creates a new row. */
export async function duplicatePrompt(hostId: string, promptId: string) {
  const source = await getOwnedPrompt(hostId, promptId);
  return prisma.$transaction(async (tx) => {
    const count = await tx.playlistPrompt.count({ where: { playlistId: source.playlistId } });
    const copy = await tx.playlistPrompt.create({
      data: {
        playlistId: source.playlistId,
        position: count,
        text: source.text,
        durationSeconds: source.durationSeconds,
      },
    });
    await touchPlaylist(tx, source.playlistId);
    return copy;
  });
}

export async function deletePrompt(hostId: string, promptId: string): Promise<void> {
  const prompt = await getOwnedPrompt(hostId, promptId);
  await prisma.$transaction(async (tx) => {
    await tx.playlistPrompt.delete({ where: { id: prompt.id } });
    await touchPlaylist(tx, prompt.playlistId);
  });
}

export async function reorderPrompts(hostId: string, playlistId: string, orderedPromptIds: string[]): Promise<void> {
  const playlist = await getOwnedDrawingPlaylist(hostId, playlistId);
  const existingIds = new Set(playlist.prompts.map((p) => p.id));
  if (orderedPromptIds.length !== existingIds.size || orderedPromptIds.some((id) => !existingIds.has(id))) {
    throw new ContentError("VALIDATION", "Reorder list must match this playlist's prompts exactly.");
  }
  await prisma.$transaction([
    ...orderedPromptIds.map((id, position) => prisma.playlistPrompt.update({ where: { id }, data: { position } })),
    prisma.playlist.update({ where: { id: playlistId }, data: { updatedAt: new Date() } }),
  ]);
}

/** Whether ANY session currently has an in-progress game snapshotted from this playlist — same "informational, never gates editing" purpose as content.ts's isPlaylistInUse / contentGeo.ts's isGeoPlaylistInUse. */
export async function isDrawingPlaylistInUse(playlistId: string): Promise<boolean> {
  const live = await prisma.sessionGame.findFirst({ where: { playlistId, status: "IN_PROGRESS" }, select: { id: true } });
  return live !== null;
}
