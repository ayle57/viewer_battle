import type { BoardCategory, BoardQuestion, BoardQuestionConfig } from "@/domain/game/boardQuestion";

/**
 * Pure input shapes for the mapping below — deliberately NOT Prisma's
 * generated row types (src/domain must stay Prisma-free, see AGENTS.md
 * "Folder boundaries"). src/server/db/content.ts is responsible for
 * shaping its Prisma query results into these plain objects before
 * calling in here.
 */
export interface ContentCategoryInput {
  id: string;
  name: string;
}

export interface ContentQuestionInput {
  id: string;
  categoryId: string;
  value: number;
  prompt: string;
  answer: string;
}

/**
 * Turns a prepared playlist (categories + questions, already loaded and
 * ownership-checked by the server) into exactly the config shape
 * BoardQuestionEngine.createInitialState expects — the ONE place Content
 * Studio data crosses into Game Kernel data. Pure and total: no I/O, no
 * Prisma types, nothing engine-specific beyond the shape itself.
 *
 * This is also where the "snapshot, not a live reference" guarantee
 * actually lives structurally: the caller (src/server/game/service.ts's
 * startGame) passes the RESULT of this function into
 * engine.createInitialState, which copies it into SessionGame.internalState
 * as its own independent JSON blob. Nothing downstream keeps a pointer
 * back to the Playlist row, so an edit made after this call can never
 * reach the game it already started.
 */
export function playlistToBoardQuestionConfig(
  categories: ContentCategoryInput[],
  questions: ContentQuestionInput[],
): BoardQuestionConfig {
  const boardCategories: BoardCategory[] = categories.map((c) => ({ id: c.id, name: c.name }));
  const boardQuestions: BoardQuestion[] = questions.map((q) => ({
    id: q.id,
    categoryId: q.categoryId,
    points: q.value,
    prompt: q.prompt,
    answer: q.answer,
  }));
  return { categories: boardCategories, questions: boardQuestions };
}
