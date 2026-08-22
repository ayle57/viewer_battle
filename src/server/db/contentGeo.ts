import { ContentError, getGeoPlaylistReadiness } from "@/domain/content";
import type { GeoPlaylistReadiness } from "@/domain/content";
import { prisma } from "@/server/db/client";
import type { Prisma } from "@/generated/prisma/client";

/**
 * All GeoGuessr Content Studio persistence — Playlist/PlaylistRound CRUD,
 * always scoped to a `hostId` resolved from the SAME ContentHost bearer
 * token content.ts's Jeopardy procedures use (one Content Studio
 * identity for every game — see prisma/schema.prisma's ContentHost
 * comment). A deliberately SEPARATE, self-contained module from
 * content.ts rather than branching content.ts's own functions by
 * gameKey: Jeopardy's functions return a Jeopardy-shaped summary
 * (categoryCount/questionCount/PlaylistReadiness over categories) that
 * genuinely doesn't fit GeoGuessr's flat rounds, and duplicating a
 * handful of small, independently-testable queries here carries zero
 * risk of changing Jeopardy's tested behavior — see AGENTS.md-equivalent
 * instruction for this pass: don't touch Jeopardy's rules.
 *
 * Same IDOR-safe shape as content.ts throughout: every query filters
 * ownership directly IN the query (never "fetch by id, then compare a
 * field"), so a row belonging to a different host is indistinguishable
 * from one that doesn't exist.
 */

const GEO_PLAYLIST_INCLUDE = {
  rounds: { orderBy: { position: "asc" } },
} satisfies Prisma.PlaylistInclude;

/** How many round images the library grid shows per card — a glance-able stack, not a full filmstrip (see toGeoSummary's own doc comment). */
const SUMMARY_THUMBNAIL_COUNT = 3;

export interface GeoPlaylistSummary {
  id: string;
  name: string;
  description: string | null;
  gameKey: string;
  roundCount: number;
  readiness: GeoPlaylistReadiness;
  /** Up to the first SUMMARY_THUMBNAIL_COUNT rounds' images, in round order, skipping rounds with no image yet — purely a library-grid preview (item 1's "map library" card), never read by the Game Kernel or anything readiness-related. */
  thumbnails: string[];
  createdAt: Date;
  updatedAt: Date;
}

function toGeoSummary(playlist: Prisma.PlaylistGetPayload<{ include: typeof GEO_PLAYLIST_INCLUDE }>): GeoPlaylistSummary {
  const readiness = getGeoPlaylistReadiness(playlist.rounds);
  const thumbnails = playlist.rounds
    .map((r) => r.imageUrl)
    .filter((url): url is string => Boolean(url))
    .slice(0, SUMMARY_THUMBNAIL_COUNT);
  return {
    id: playlist.id,
    name: playlist.name,
    description: playlist.description,
    gameKey: playlist.gameKey,
    roundCount: readiness.roundCount,
    readiness,
    thumbnails,
    createdAt: playlist.createdAt,
    updatedAt: playlist.updatedAt,
  };
}

export async function listGeoPlaylists(hostId: string, gameKey: string): Promise<GeoPlaylistSummary[]> {
  const playlists = await prisma.playlist.findMany({
    where: { hostId, gameKey },
    orderBy: { updatedAt: "desc" },
    include: GEO_PLAYLIST_INCLUDE,
  });
  return playlists.map(toGeoSummary);
}

export async function createGeoPlaylist(hostId: string, gameKey: string, name: string, description?: string): Promise<GeoPlaylistSummary> {
  const trimmed = name.trim();
  if (!trimmed) throw new ContentError("VALIDATION", "Playlist name can't be empty.");
  const playlist = await prisma.playlist.create({
    data: { hostId, gameKey, name: trimmed, description: description?.trim() || null },
    include: GEO_PLAYLIST_INCLUDE,
  });
  return toGeoSummary(playlist);
}

export type GeoPlaylistDetail = Prisma.PlaylistGetPayload<{ include: typeof GEO_PLAYLIST_INCLUDE }>;

export async function getOwnedGeoPlaylist(hostId: string, playlistId: string): Promise<GeoPlaylistDetail> {
  const playlist = await prisma.playlist.findFirst({ where: { id: playlistId, hostId }, include: GEO_PLAYLIST_INCLUDE });
  if (!playlist) throw new ContentError("PLAYLIST_NOT_FOUND");
  return playlist;
}

export async function updateGeoPlaylist(
  hostId: string,
  playlistId: string,
  data: { name?: string; description?: string | null },
): Promise<GeoPlaylistSummary> {
  await getOwnedGeoPlaylist(hostId, playlistId); // throws PLAYLIST_NOT_FOUND if not owned
  const name = data.name !== undefined ? data.name.trim() : undefined;
  if (name !== undefined && !name) throw new ContentError("VALIDATION", "Playlist name can't be empty.");
  const playlist = await prisma.playlist.update({
    where: { id: playlistId },
    data: { name, description: data.description !== undefined ? data.description?.trim() || null : undefined },
    include: GEO_PLAYLIST_INCLUDE,
  });
  return toGeoSummary(playlist);
}

export async function deleteGeoPlaylist(hostId: string, playlistId: string): Promise<void> {
  await getOwnedGeoPlaylist(hostId, playlistId);
  await prisma.playlist.delete({ where: { id: playlistId } }); // cascades rounds
}

export async function duplicateGeoPlaylist(hostId: string, playlistId: string): Promise<GeoPlaylistSummary> {
  const source = await getOwnedGeoPlaylist(hostId, playlistId);
  const created = await prisma.$transaction(async (tx) => {
    const copy = await tx.playlist.create({
      data: { hostId, gameKey: source.gameKey, name: `${source.name} (Copy)`, description: source.description },
    });
    if (source.rounds.length > 0) {
      await tx.playlistRound.createMany({
        data: source.rounds.map((r) => ({
          playlistId: copy.id,
          position: r.position,
          title: r.title,
          imageUrl: r.imageUrl,
          question: r.question,
          targetX: r.targetX,
          targetY: r.targetY,
        })),
      });
    }
    return tx.playlist.findUniqueOrThrow({ where: { id: copy.id }, include: GEO_PLAYLIST_INCLUDE });
  });
  return toGeoSummary(created);
}

async function touchPlaylist(tx: Prisma.TransactionClient, playlistId: string): Promise<void> {
  await tx.playlist.update({ where: { id: playlistId }, data: { updatedAt: new Date() } });
}

// --- Rounds ---

async function getOwnedRound(hostId: string, roundId: string) {
  const round = await prisma.playlistRound.findFirst({ where: { id: roundId, playlist: { hostId } } });
  if (!round) throw new ContentError("ROUND_NOT_FOUND");
  return round;
}

/** A round starts as an empty shell — image/target are added by updateRound, same "exists but incomplete" shape as PlaylistCategory having zero questions (see readiness.ts's own reasoning, mirrored in geoReadiness.ts). */
export async function createRound(hostId: string, playlistId: string, title?: string) {
  await getOwnedGeoPlaylist(hostId, playlistId);
  return prisma.$transaction(async (tx) => {
    const count = await tx.playlistRound.count({ where: { playlistId } });
    const round = await tx.playlistRound.create({
      data: { playlistId, position: count, title: title?.trim() || null },
    });
    await touchPlaylist(tx, playlistId);
    return round;
  });
}

export interface RoundInput {
  title?: string | null;
  imageUrl?: string | null;
  question?: string | null;
  targetX?: number | null;
  targetY?: number | null;
}

function validateRoundInput(input: RoundInput) {
  if (input.imageUrl !== undefined && input.imageUrl !== null && !input.imageUrl.trim()) {
    throw new ContentError("VALIDATION", "Image can't be blank.");
  }
  if (input.question !== undefined && input.question !== null && !input.question.trim()) {
    throw new ContentError("VALIDATION", "Question can't be blank.");
  }
  const coord = (v: number | null | undefined) => v === undefined || v === null || (Number.isFinite(v) && v >= 0 && v <= 1);
  if (!coord(input.targetX) || !coord(input.targetY)) {
    throw new ContentError("VALIDATION", "Target coordinates must be between 0 and 1.");
  }
}

export async function updateRound(hostId: string, roundId: string, input: RoundInput) {
  validateRoundInput(input);
  const round = await getOwnedRound(hostId, roundId);

  // A target is a PAIR — half a target (only x or only y ends up set) is
  // not a valid state to persist, same "both or neither" guarantee the
  // round editor's own click handler already keeps client-side, enforced
  // again here since the server never trusts client-side guarantees.
  // Checked against the EFFECTIVE final value (this input where
  // provided, the round's already-persisted value otherwise) — not the
  // raw partial input in isolation, which would miss the real case an
  // integration test caught: `update({ targetX: 0.5 })` alone, with
  // `targetY` simply omitted (not explicitly null), against a round
  // whose `targetY` was already null, silently produces a half-set
  // target if only the raw input were checked.
  const finalX = input.targetX !== undefined ? input.targetX : round.targetX;
  const finalY = input.targetY !== undefined ? input.targetY : round.targetY;
  if ((finalX === null) !== (finalY === null)) {
    throw new ContentError("VALIDATION", "Target coordinates must be set together.");
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.playlistRound.update({
      where: { id: round.id },
      data: {
        title: input.title !== undefined ? input.title?.trim() || null : undefined,
        imageUrl: input.imageUrl !== undefined ? input.imageUrl?.trim() || null : undefined,
        question: input.question !== undefined ? input.question?.trim() || null : undefined,
        targetX: input.targetX,
        targetY: input.targetY,
      },
    });
    await touchPlaylist(tx, round.playlistId);
    return updated;
  });
}

/**
 * Copies one round — question, target, AND the image reference — into a
 * brand-new row at the end of the SAME playlist, same shape as
 * content.ts's `duplicateQuestion`. Safe to just copy the `imageUrl`
 * STRING rather than the underlying file: an uploaded map was never
 * owned per-round to begin with (see geoAssets.ts's own doc comment —
 * it's a shared pool every round in every playlist picks a path INTO,
 * the exact same many-rounds-one-file relationship `sampleGeoPlaylist`
 * itself already relies on for its two fixture rounds). The original
 * round is never touched — this only ever creates a new row.
 */
export async function duplicateRound(hostId: string, roundId: string) {
  const source = await getOwnedRound(hostId, roundId);
  return prisma.$transaction(async (tx) => {
    const count = await tx.playlistRound.count({ where: { playlistId: source.playlistId } });
    const copy = await tx.playlistRound.create({
      data: {
        playlistId: source.playlistId,
        position: count,
        title: source.title ? `${source.title} (Copy)` : null,
        imageUrl: source.imageUrl,
        question: source.question,
        targetX: source.targetX,
        targetY: source.targetY,
      },
    });
    await touchPlaylist(tx, source.playlistId);
    return copy;
  });
}

export async function deleteRound(hostId: string, roundId: string): Promise<void> {
  const round = await getOwnedRound(hostId, roundId);
  await prisma.$transaction(async (tx) => {
    await tx.playlistRound.delete({ where: { id: round.id } });
    await touchPlaylist(tx, round.playlistId);
  });
}

export async function reorderRounds(hostId: string, playlistId: string, orderedRoundIds: string[]): Promise<void> {
  const playlist = await getOwnedGeoPlaylist(hostId, playlistId);
  const existingIds = new Set(playlist.rounds.map((r) => r.id));
  if (orderedRoundIds.length !== existingIds.size || orderedRoundIds.some((id) => !existingIds.has(id))) {
    throw new ContentError("VALIDATION", "Reorder list must match this playlist's rounds exactly.");
  }
  await prisma.$transaction([
    ...orderedRoundIds.map((id, position) => prisma.playlistRound.update({ where: { id }, data: { position } })),
    prisma.playlist.update({ where: { id: playlistId }, data: { updatedAt: new Date() } }),
  ]);
}

/** Whether ANY session currently has an in-progress game snapshotted from this playlist — same "informational, never gates editing" purpose as content.ts's isPlaylistInUse. */
export async function isGeoPlaylistInUse(playlistId: string): Promise<boolean> {
  const live = await prisma.sessionGame.findFirst({ where: { playlistId, status: "IN_PROGRESS" }, select: { id: true } });
  return live !== null;
}
