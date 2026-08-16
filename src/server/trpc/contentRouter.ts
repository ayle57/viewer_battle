import { z } from "zod";
import { getPlaylistReadiness } from "@/domain/content";
import { router, publicProcedure } from "@/server/trpc/trpc";
import { toContentTRPCError } from "@/server/trpc/contentErrors";
import { createContentHost, resolveContentHost } from "@/server/db/contentHost";
import {
  createCategory,
  createPlaylist,
  createQuestion,
  deleteCategory,
  deletePlaylist,
  deleteQuestion,
  duplicatePlaylist,
  duplicateQuestion,
  getOwnedPlaylist,
  isPlaylistInUse,
  listPlaylists,
  renameCategory,
  reorderCategories,
  reorderQuestions,
  updatePlaylist,
  updateQuestion,
} from "@/server/db/content";

/**
 * Content Studio's tRPC surface — everything a Host uses to prepare a
 * show BEFORE it's live (Playlists/Categories/Questions). Deliberately a
 * separate router/identity from `session`/`game` above: every procedure
 * here resolves a ContentHost bearer token (src/server/db/contentHost.ts),
 * never a session Participant token — see prisma/schema.prisma's "Content
 * Studio" comment for why those two identities are kept apart. Request/
 * response CRUD only, matching AGENTS.md's tRPC-for-setup /
 * Socket.IO-for-realtime split — nothing here is realtime.
 *
 * Every mutation/query re-derives `hostId` from `token` itself (never
 * trusts a `hostId` passed by the client) and every src/server/db/content.ts
 * query filters ownership directly in the query — see that file's doc
 * comment for why that's the IDOR-safe shape.
 */
const gameKeySchema = z.literal("board-question");

async function requireHostId(token: string): Promise<string> {
  try {
    const { hostId } = await resolveContentHost(token);
    return hostId;
  } catch (error) {
    throw toContentTRPCError(error);
  }
}

const authRouter = router({
  /** Verifies HOST_PASSWORD (same shared secret as session.create) and issues a fresh, durable ContentHost token — stored client-side in localStorage, never re-derivable server-side if lost. */
  login: publicProcedure.input(z.object({ hostPassword: z.string().min(1) })).mutation(async ({ input }) => {
    try {
      const { token } = await createContentHost(input.hostPassword);
      return { token };
    } catch (error) {
      throw toContentTRPCError(error);
    }
  }),

  /** Confirms a stored token still resolves to a real ContentHost — used on /host/content load to decide "show the login form" vs. "go straight to the studio" without a mutation. */
  me: publicProcedure.input(z.object({ token: z.string().min(1) })).query(async ({ input }) => {
    await requireHostId(input.token);
    return { ok: true as const };
  }),
});

const playlistRouter = router({
  list: publicProcedure.input(z.object({ token: z.string().min(1), gameKey: gameKeySchema })).query(async ({ input }) => {
    const hostId = await requireHostId(input.token);
    return listPlaylists(hostId, input.gameKey);
  }),

  create: publicProcedure
    .input(z.object({ token: z.string().min(1), gameKey: gameKeySchema, name: z.string().min(1), description: z.string().optional() }))
    .mutation(async ({ input }) => {
      const hostId = await requireHostId(input.token);
      try {
        return await createPlaylist(hostId, input.gameKey, input.name, input.description);
      } catch (error) {
        throw toContentTRPCError(error);
      }
    }),

  /** Full board, ownership-checked — never a bare findUnique by id. Includes `inUse` for the "this playlist is currently live" banner, and `readiness` (src/domain/content/readiness.ts) so the playlist editor's own header shows the exact same computed status as the Library card and the Host lobby's content picker. */
  get: publicProcedure.input(z.object({ token: z.string().min(1), playlistId: z.string().min(1) })).query(async ({ input }) => {
    const hostId = await requireHostId(input.token);
    try {
      const [playlist, inUse] = await Promise.all([
        getOwnedPlaylist(hostId, input.playlistId),
        isPlaylistInUse(input.playlistId),
      ]);
      return { ...playlist, inUse, readiness: getPlaylistReadiness(playlist.categories) };
    } catch (error) {
      throw toContentTRPCError(error);
    }
  }),

  update: publicProcedure
    .input(z.object({ token: z.string().min(1), playlistId: z.string().min(1), name: z.string().optional(), description: z.string().nullable().optional() }))
    .mutation(async ({ input }) => {
      const hostId = await requireHostId(input.token);
      try {
        return await updatePlaylist(hostId, input.playlistId, { name: input.name, description: input.description });
      } catch (error) {
        throw toContentTRPCError(error);
      }
    }),

  delete: publicProcedure.input(z.object({ token: z.string().min(1), playlistId: z.string().min(1) })).mutation(async ({ input }) => {
    const hostId = await requireHostId(input.token);
    try {
      await deletePlaylist(hostId, input.playlistId);
      return { ok: true as const };
    } catch (error) {
      throw toContentTRPCError(error);
    }
  }),

  duplicate: publicProcedure.input(z.object({ token: z.string().min(1), playlistId: z.string().min(1) })).mutation(async ({ input }) => {
    const hostId = await requireHostId(input.token);
    try {
      return await duplicatePlaylist(hostId, input.playlistId);
    } catch (error) {
      throw toContentTRPCError(error);
    }
  }),
});

const categoryRouter = router({
  create: publicProcedure
    .input(z.object({ token: z.string().min(1), playlistId: z.string().min(1), name: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const hostId = await requireHostId(input.token);
      try {
        return await createCategory(hostId, input.playlistId, input.name);
      } catch (error) {
        throw toContentTRPCError(error);
      }
    }),

  rename: publicProcedure
    .input(z.object({ token: z.string().min(1), categoryId: z.string().min(1), name: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const hostId = await requireHostId(input.token);
      try {
        return await renameCategory(hostId, input.categoryId, input.name);
      } catch (error) {
        throw toContentTRPCError(error);
      }
    }),

  delete: publicProcedure.input(z.object({ token: z.string().min(1), categoryId: z.string().min(1) })).mutation(async ({ input }) => {
    const hostId = await requireHostId(input.token);
    try {
      await deleteCategory(hostId, input.categoryId);
      return { ok: true as const };
    } catch (error) {
      throw toContentTRPCError(error);
    }
  }),

  reorder: publicProcedure
    .input(z.object({ token: z.string().min(1), playlistId: z.string().min(1), orderedCategoryIds: z.array(z.string().min(1)) }))
    .mutation(async ({ input }) => {
      const hostId = await requireHostId(input.token);
      try {
        await reorderCategories(hostId, input.playlistId, input.orderedCategoryIds);
        return { ok: true as const };
      } catch (error) {
        throw toContentTRPCError(error);
      }
    }),
});

const questionInputShape = { value: z.number().int().positive(), prompt: z.string().min(1), answer: z.string().min(1) };

const questionRouter = router({
  create: publicProcedure
    .input(z.object({ token: z.string().min(1), categoryId: z.string().min(1), ...questionInputShape }))
    .mutation(async ({ input }) => {
      const hostId = await requireHostId(input.token);
      try {
        return await createQuestion(hostId, input.categoryId, { value: input.value, prompt: input.prompt, answer: input.answer });
      } catch (error) {
        throw toContentTRPCError(error);
      }
    }),

  update: publicProcedure
    .input(
      z.object({
        token: z.string().min(1),
        questionId: z.string().min(1),
        value: z.number().int().positive().optional(),
        prompt: z.string().min(1).optional(),
        answer: z.string().min(1).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const hostId = await requireHostId(input.token);
      try {
        return await updateQuestion(hostId, input.questionId, { value: input.value, prompt: input.prompt, answer: input.answer });
      } catch (error) {
        throw toContentTRPCError(error);
      }
    }),

  delete: publicProcedure.input(z.object({ token: z.string().min(1), questionId: z.string().min(1) })).mutation(async ({ input }) => {
    const hostId = await requireHostId(input.token);
    try {
      await deleteQuestion(hostId, input.questionId);
      return { ok: true as const };
    } catch (error) {
      throw toContentTRPCError(error);
    }
  }),

  duplicate: publicProcedure.input(z.object({ token: z.string().min(1), questionId: z.string().min(1) })).mutation(async ({ input }) => {
    const hostId = await requireHostId(input.token);
    try {
      return await duplicateQuestion(hostId, input.questionId);
    } catch (error) {
      throw toContentTRPCError(error);
    }
  }),

  reorder: publicProcedure
    .input(z.object({ token: z.string().min(1), categoryId: z.string().min(1), orderedQuestionIds: z.array(z.string().min(1)) }))
    .mutation(async ({ input }) => {
      const hostId = await requireHostId(input.token);
      try {
        await reorderQuestions(hostId, input.categoryId, input.orderedQuestionIds);
        return { ok: true as const };
      } catch (error) {
        throw toContentTRPCError(error);
      }
    }),
});

export const contentRouter = router({
  auth: authRouter,
  playlist: playlistRouter,
  category: categoryRouter,
  question: questionRouter,
});
