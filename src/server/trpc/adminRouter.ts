import { z } from "zod";
import { toContentTRPCError } from "@/server/trpc/contentErrors";
import { toUserTRPCError } from "@/server/trpc/userErrors";
import { router, publicProcedure } from "@/server/trpc/trpc";
import { resolveContentHost } from "@/server/db/contentHost";
import { deleteUser, getPlatformStats, listUsersWithStats } from "@/server/db/user";
import { addBlockedWord, listBlockedWords, removeBlockedWord } from "@/server/db/blockedWords";

/**
 * The operator's admin dashboard — user management + platform-wide stats.
 * Deliberately gated behind the SAME ContentHost token as Content Studio
 * (`resolveContentHost`, `requireHostId` below), not a fourth identity
 * system of its own: "there is exactly one real Host identity in
 * practice" (see src/server/db/contentHost.ts's own doc comment) already
 * means whoever can sign into Content Studio with HOST_PASSWORD IS the
 * operator — reusing that token here is one fewer login, not a shortcut,
 * for a page (/host/content/admin) that already renders behind Content
 * Studio's own layout gate (src/app/host/content/layout.tsx).
 */
async function requireHostId(token: string): Promise<string> {
  try {
    const { hostId } = await resolveContentHost(token);
    return hostId;
  } catch (error) {
    throw toContentTRPCError(error);
  }
}

export const adminRouter = router({
  overview: publicProcedure.input(z.object({ token: z.string().min(1) })).query(async ({ input }) => {
    await requireHostId(input.token);
    return getPlatformStats();
  }),

  users: publicProcedure.input(z.object({ token: z.string().min(1) })).query(async ({ input }) => {
    await requireHostId(input.token);
    return listUsersWithStats();
  }),

  deleteUser: publicProcedure.input(z.object({ token: z.string().min(1), userId: z.string().min(1) })).mutation(async ({ input }) => {
    await requireHostId(input.token);
    try {
      await deleteUser(input.userId);
      return { ok: true as const };
    } catch (error) {
      throw toUserTRPCError(error);
    }
  }),

  // --- Chat word filter (src/server/db/blockedWords.ts + src/domain/chat/wordFilter.ts) ---

  blockedWords: publicProcedure.input(z.object({ token: z.string().min(1) })).query(async ({ input }) => {
    await requireHostId(input.token);
    return listBlockedWords();
  }),

  addBlockedWord: publicProcedure
    .input(z.object({ token: z.string().min(1), word: z.string().trim().min(1, "Enter a word").max(80, "That's too long for a single entry") }))
    .mutation(async ({ input }) => {
      await requireHostId(input.token);
      return addBlockedWord(input.word);
    }),

  removeBlockedWord: publicProcedure
    .input(z.object({ token: z.string().min(1), id: z.string().min(1) }))
    .mutation(async ({ input }) => {
      await requireHostId(input.token);
      await removeBlockedWord(input.id);
      return { ok: true as const };
    }),
});
