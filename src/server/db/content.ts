import { ContentError, getPlaylistReadiness } from "@/domain/content";
import type { PlaylistReadiness } from "@/domain/content";
import { prisma } from "@/server/db/client";
import type { Prisma } from "@/generated/prisma/client";

/**
 * All Content Studio persistence — Playlist/PlaylistCategory/
 * PlaylistQuestion CRUD, always scoped to a `hostId` resolved from a
 * ContentHost bearer token (src/server/db/contentHost.ts) by the caller
 * (src/server/trpc/contentRouter.ts). Every read/write below filters
 * ownership directly IN the query (never "fetch by id, then compare a
 * field") — the IDOR-safe shape: a row belonging to a different host
 * simply doesn't match the query, so it comes back as PLAYLIST_NOT_FOUND/
 * CATEGORY_NOT_FOUND/QUESTION_NOT_FOUND, the same as it not existing at
 * all, never a distinguishable "found but forbidden."
 */

// Fetches full question rows (not just a _count) — readiness (see
// src/domain/content/readiness.ts) needs each question's value/prompt/
// answer to know whether it's actually complete, not just how many
// exist. Same shape as PLAYLIST_DETAIL_INCLUDE below on purpose: one
// query shape, one readiness computation, reused by both the list and
// the single-playlist views so "is this board ready" can never drift
// between the Library card and the playlist editor.
const PLAYLIST_SUMMARY_INCLUDE = {
  categories: {
    orderBy: { position: "asc" },
    include: { questions: { orderBy: { position: "asc" } } },
  },
} satisfies Prisma.PlaylistInclude;

export interface PlaylistSummary {
  id: string;
  name: string;
  description: string | null;
  gameKey: string;
  categoryCount: number;
  questionCount: number;
  readiness: PlaylistReadiness;
  createdAt: Date;
  updatedAt: Date;
}

function toSummary(playlist: Prisma.PlaylistGetPayload<{ include: typeof PLAYLIST_SUMMARY_INCLUDE }>): PlaylistSummary {
  const readiness = getPlaylistReadiness(playlist.categories);
  return {
    id: playlist.id,
    name: playlist.name,
    description: playlist.description,
    gameKey: playlist.gameKey,
    categoryCount: readiness.categoryCount,
    questionCount: readiness.questionCount,
    readiness,
    createdAt: playlist.createdAt,
    updatedAt: playlist.updatedAt,
  };
}

export async function listPlaylists(hostId: string, gameKey: string): Promise<PlaylistSummary[]> {
  const playlists = await prisma.playlist.findMany({
    where: { hostId, gameKey },
    orderBy: { updatedAt: "desc" },
    include: PLAYLIST_SUMMARY_INCLUDE,
  });
  return playlists.map(toSummary);
}

export async function createPlaylist(hostId: string, gameKey: string, name: string, description?: string): Promise<PlaylistSummary> {
  const trimmed = name.trim();
  if (!trimmed) throw new ContentError("VALIDATION", "Playlist name can't be empty.");
  const playlist = await prisma.playlist.create({
    data: { hostId, gameKey, name: trimmed, description: description?.trim() || null },
    include: PLAYLIST_SUMMARY_INCLUDE,
  });
  return toSummary(playlist);
}

// Same shape as PLAYLIST_SUMMARY_INCLUDE above — kept as its own name for
// callers that want the full detail type, not because the query differs.
const PLAYLIST_DETAIL_INCLUDE = PLAYLIST_SUMMARY_INCLUDE;

export type PlaylistDetail = Prisma.PlaylistGetPayload<{ include: typeof PLAYLIST_DETAIL_INCLUDE }>;

/** Ownership-checked full playlist load — the query itself filters `hostId`, so a wrong-owner id is indistinguishable from a nonexistent one. */
export async function getOwnedPlaylist(hostId: string, playlistId: string): Promise<PlaylistDetail> {
  const playlist = await prisma.playlist.findFirst({ where: { id: playlistId, hostId }, include: PLAYLIST_DETAIL_INCLUDE });
  if (!playlist) throw new ContentError("PLAYLIST_NOT_FOUND");
  return playlist;
}

/** Whether ANY session currently has an in-progress game snapshotted from this playlist — purely informational for the "this playlist is live" banner (see prisma/schema.prisma's SessionGame.playlistId comment); never gates whether the playlist can be edited. */
export async function isPlaylistInUse(playlistId: string): Promise<boolean> {
  const live = await prisma.sessionGame.findFirst({ where: { playlistId, status: "IN_PROGRESS" }, select: { id: true } });
  return live !== null;
}

export async function updatePlaylist(
  hostId: string,
  playlistId: string,
  data: { name?: string; description?: string | null },
): Promise<PlaylistSummary> {
  await getOwnedPlaylist(hostId, playlistId); // throws PLAYLIST_NOT_FOUND if not owned
  const name = data.name !== undefined ? data.name.trim() : undefined;
  if (name !== undefined && !name) throw new ContentError("VALIDATION", "Playlist name can't be empty.");
  const playlist = await prisma.playlist.update({
    where: { id: playlistId },
    data: { name, description: data.description !== undefined ? data.description?.trim() || null : undefined },
    include: PLAYLIST_SUMMARY_INCLUDE,
  });
  return toSummary(playlist);
}

export async function deletePlaylist(hostId: string, playlistId: string): Promise<void> {
  await getOwnedPlaylist(hostId, playlistId);
  await prisma.playlist.delete({ where: { id: playlistId } }); // cascades categories + questions
}

export async function duplicatePlaylist(hostId: string, playlistId: string): Promise<PlaylistSummary> {
  const source = await getOwnedPlaylist(hostId, playlistId);
  const created = await prisma.$transaction(async (tx) => {
    const copy = await tx.playlist.create({
      data: { hostId, gameKey: source.gameKey, name: `${source.name} (Copy)`, description: source.description },
    });
    for (const category of source.categories) {
      const newCategory = await tx.playlistCategory.create({
        data: { playlistId: copy.id, name: category.name, position: category.position },
      });
      if (category.questions.length > 0) {
        await tx.playlistQuestion.createMany({
          data: category.questions.map((q) => ({
            categoryId: newCategory.id,
            playlistId: copy.id,
            value: q.value,
            prompt: q.prompt,
            answer: q.answer,
            position: q.position,
          })),
        });
      }
    }
    return tx.playlist.findUniqueOrThrow({ where: { id: copy.id }, include: PLAYLIST_SUMMARY_INCLUDE });
  });
  return toSummary(created);
}

async function touchPlaylist(tx: Prisma.TransactionClient, playlistId: string): Promise<void> {
  await tx.playlist.update({ where: { id: playlistId }, data: { updatedAt: new Date() } });
}

// --- Categories ---

async function getOwnedCategory(hostId: string, categoryId: string) {
  const category = await prisma.playlistCategory.findFirst({
    where: { id: categoryId, playlist: { hostId } },
    include: { questions: { select: { id: true }, orderBy: { position: "asc" } } },
  });
  if (!category) throw new ContentError("CATEGORY_NOT_FOUND");
  return category;
}

export async function createCategory(hostId: string, playlistId: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new ContentError("VALIDATION", "Category name can't be empty.");
  await getOwnedPlaylist(hostId, playlistId);
  return prisma.$transaction(async (tx) => {
    const count = await tx.playlistCategory.count({ where: { playlistId } });
    const category = await tx.playlistCategory.create({ data: { playlistId, name: trimmed, position: count } });
    await touchPlaylist(tx, playlistId);
    return category;
  });
}

export async function renameCategory(hostId: string, categoryId: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new ContentError("VALIDATION", "Category name can't be empty.");
  const category = await getOwnedCategory(hostId, categoryId);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.playlistCategory.update({ where: { id: category.id }, data: { name: trimmed } });
    await touchPlaylist(tx, category.playlistId);
    return updated;
  });
}

export async function deleteCategory(hostId: string, categoryId: string): Promise<void> {
  const category = await getOwnedCategory(hostId, categoryId);
  await prisma.$transaction(async (tx) => {
    await tx.playlistCategory.delete({ where: { id: category.id } }); // cascades questions
    await touchPlaylist(tx, category.playlistId);
  });
}

export async function reorderCategories(hostId: string, playlistId: string, orderedCategoryIds: string[]): Promise<void> {
  const playlist = await getOwnedPlaylist(hostId, playlistId);
  const existingIds = new Set(playlist.categories.map((c) => c.id));
  if (orderedCategoryIds.length !== existingIds.size || orderedCategoryIds.some((id) => !existingIds.has(id))) {
    throw new ContentError("VALIDATION", "Reorder list must match this playlist's categories exactly.");
  }
  await prisma.$transaction([
    ...orderedCategoryIds.map((id, position) => prisma.playlistCategory.update({ where: { id }, data: { position } })),
    prisma.playlist.update({ where: { id: playlistId }, data: { updatedAt: new Date() } }),
  ]);
}

// --- Questions ---

async function getOwnedQuestion(hostId: string, questionId: string) {
  const question = await prisma.playlistQuestion.findFirst({ where: { id: questionId, category: { playlist: { hostId } } } });
  if (!question) throw new ContentError("QUESTION_NOT_FOUND");
  return question;
}

export interface QuestionInput {
  value: number;
  prompt: string;
  answer: string;
}

function validateQuestionInput(input: Partial<QuestionInput>) {
  if (input.value !== undefined && (!Number.isInteger(input.value) || input.value <= 0)) {
    throw new ContentError("VALIDATION", "Value must be a positive whole number.");
  }
  if (input.prompt !== undefined && !input.prompt.trim()) {
    throw new ContentError("VALIDATION", "Question text can't be empty.");
  }
  if (input.answer !== undefined && !input.answer.trim()) {
    throw new ContentError("VALIDATION", "Answer can't be empty.");
  }
}

export async function createQuestion(hostId: string, categoryId: string, input: QuestionInput) {
  validateQuestionInput(input);
  const category = await getOwnedCategory(hostId, categoryId);
  return prisma.$transaction(async (tx) => {
    const count = await tx.playlistQuestion.count({ where: { categoryId } });
    const question = await tx.playlistQuestion.create({
      data: {
        categoryId,
        playlistId: category.playlistId,
        value: input.value,
        prompt: input.prompt.trim(),
        answer: input.answer.trim(),
        position: count,
      },
    });
    await touchPlaylist(tx, category.playlistId);
    return question;
  });
}

export async function updateQuestion(hostId: string, questionId: string, input: Partial<QuestionInput>) {
  validateQuestionInput(input);
  const question = await getOwnedQuestion(hostId, questionId);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.playlistQuestion.update({
      where: { id: question.id },
      data: {
        value: input.value,
        prompt: input.prompt?.trim(),
        answer: input.answer?.trim(),
      },
    });
    await touchPlaylist(tx, question.playlistId);
    return updated;
  });
}

export async function deleteQuestion(hostId: string, questionId: string): Promise<void> {
  const question = await getOwnedQuestion(hostId, questionId);
  await prisma.$transaction(async (tx) => {
    await tx.playlistQuestion.delete({ where: { id: question.id } });
    await touchPlaylist(tx, question.playlistId);
  });
}

export async function duplicateQuestion(hostId: string, questionId: string) {
  const question = await getOwnedQuestion(hostId, questionId);
  return prisma.$transaction(async (tx) => {
    const count = await tx.playlistQuestion.count({ where: { categoryId: question.categoryId } });
    const copy = await tx.playlistQuestion.create({
      data: {
        categoryId: question.categoryId,
        playlistId: question.playlistId,
        value: question.value,
        prompt: question.prompt,
        answer: question.answer,
        position: count,
      },
    });
    await touchPlaylist(tx, question.playlistId);
    return copy;
  });
}

export async function reorderQuestions(hostId: string, categoryId: string, orderedQuestionIds: string[]): Promise<void> {
  const category = await getOwnedCategory(hostId, categoryId);
  const existingIds = new Set(category.questions.map((q) => q.id));
  if (orderedQuestionIds.length !== existingIds.size || orderedQuestionIds.some((id) => !existingIds.has(id))) {
    throw new ContentError("VALIDATION", "Reorder list must match this category's questions exactly.");
  }
  await prisma.$transaction([
    ...orderedQuestionIds.map((id, position) => prisma.playlistQuestion.update({ where: { id }, data: { position } })),
    prisma.playlist.update({ where: { id: category.playlistId }, data: { updatedAt: new Date() } }),
  ]);
}
