import { DEFAULT_BLOCKED_WORDS, normalizeBlockword } from "@/domain/chat";
import { prisma } from "@/server/db/client";
import { logger } from "@/server/logger";

export interface BlockedWordRow {
  id: string;
  word: string;
  createdAt: string;
}

const CACHE_TTL_MS = 15_000;
let cache: { words: string[]; expiresAt: number } | null = null;

/** Drop the in-memory cache — called after any add/remove so the next `chat:send` sees the change without waiting out the TTL. */
export function invalidateBlockedWordCache(): void {
  cache = null;
}

/**
 * Auto-seed: the FIRST time this table is found empty, populate it from
 * `DEFAULT_BLOCKED_WORDS`. Runs at most once per process per empty-table
 * observation; `skipDuplicates` + the unique index make a lost race
 * between two callers harmless. If the operator genuinely wants zero blocked
 * words he can delete them all — they'll just come back on the next
 * server restart, which is a fine tradeoff for "a fresh deploy is
 * protected by default".
 */
async function seedIfEmpty(): Promise<void> {
  const count = await prisma.blockedWord.count();
  if (count > 0) return;
  const rows = [...new Set(DEFAULT_BLOCKED_WORDS.map(normalizeBlockword))].filter(Boolean).map((word) => ({ word }));
  await prisma.blockedWord.createMany({ data: rows, skipDuplicates: true });
  logger.info({ seeded: rows.length }, "seeded default chat blocklist");
}

/**
 * The normalized blocklist used by the chat filter — cached in-process
 * for `CACHE_TTL_MS` so a busy channel isn't one DB read per message.
 * Any admin mutation calls `invalidateBlockedWordCache()`.
 */
export async function getBlockedWordList(): Promise<string[]> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.words;
  await seedIfEmpty();
  const rows = await prisma.blockedWord.findMany({ select: { word: true } });
  const words = rows.map((r) => r.word);
  cache = { words, expiresAt: now + CACHE_TTL_MS };
  return words;
}

/** Full list for the Admin panel — newest first, so a just-added word is at the top. */
export async function listBlockedWords(): Promise<BlockedWordRow[]> {
  await seedIfEmpty();
  const rows = await prisma.blockedWord.findMany({ orderBy: { createdAt: "desc" } });
  return rows.map((r) => ({ id: r.id, word: r.word, createdAt: r.createdAt.toISOString() }));
}

export interface AddBlockedWordResult {
  row: BlockedWordRow | null;
  /** true when the word was already on the list — the caller can treat this as a no-op success rather than an error. */
  alreadyPresent: boolean;
}

/** Add one entry (stored normalized). Adding a word that's already there is a no-op, not an error. */
export async function addBlockedWord(raw: string): Promise<AddBlockedWordResult> {
  const word = normalizeBlockword(raw);
  if (!word) return { row: null, alreadyPresent: false };
  const existing = await prisma.blockedWord.findUnique({ where: { word } });
  if (existing) return { row: null, alreadyPresent: true };
  const created = await prisma.blockedWord.create({ data: { word } });
  invalidateBlockedWordCache();
  return { row: { id: created.id, word: created.word, createdAt: created.createdAt.toISOString() }, alreadyPresent: false };
}

/** Remove one entry by id. Removing a row that's already gone is a no-op. */
export async function removeBlockedWord(id: string): Promise<void> {
  await prisma.blockedWord.deleteMany({ where: { id } });
  invalidateBlockedWordCache();
}
