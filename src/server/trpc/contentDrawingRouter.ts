import { z } from "zod";
import { router, publicProcedure } from "@/server/trpc/trpc";
import { toContentTRPCError } from "@/server/trpc/contentErrors";
import { resolveContentHost } from "@/server/db/contentHost";
import {
  createDrawingPlaylist,
  createPrompt,
  deleteDrawingPlaylist,
  deletePrompt,
  duplicateDrawingPlaylist,
  duplicatePrompt,
  getOwnedDrawingPlaylist,
  isDrawingPlaylistInUse,
  listDrawingPlaylists,
  reorderPrompts,
  updateDrawingPlaylist,
  updatePrompt,
} from "@/server/db/contentDrawing";
import { getDrawingPlaylistReadiness } from "@/domain/content";

/**
 * Drawing's Content Studio tRPC surface — the Drawing counterpart to
 * contentRouter.ts's `playlist`/`category`/`question` routers and
 * contentGeoRouter.ts's `playlist`/`round`/`asset` routers, mounted
 * alongside both under the SAME top-level `content` router (see
 * router.ts) so every game shares the one ContentHost identity/login
 * (`content.auth`) without a second sign-in flow. Kept in its own file,
 * same reasoning as contentGeoRouter.ts's own doc comment: don't touch
 * Jeopardy's or GeoGuessr's own procedures. No asset sub-router at all —
 * unlike GeoGuessr, a Drawing prompt is just text + a duration, nothing
 * uploaded.
 *
 * Same auth/ownership posture throughout: every procedure re-derives
 * `hostId` from `token` (never trusts a client-supplied hostId), and
 * every src/server/db/contentDrawing.ts query filters ownership directly
 * in the query — see that file's doc comment for why that's IDOR-safe.
 */
const drawingGameKeySchema = z.literal("drawing");

async function requireHostId(token: string): Promise<string> {
  try {
    const { hostId } = await resolveContentHost(token);
    return hostId;
  } catch (error) {
    throw toContentTRPCError(error);
  }
}

const drawingPlaylistRouter = router({
  list: publicProcedure.input(z.object({ token: z.string().min(1), gameKey: drawingGameKeySchema })).query(async ({ input }) => {
    const hostId = await requireHostId(input.token);
    return listDrawingPlaylists(hostId, input.gameKey);
  }),

  create: publicProcedure
    .input(z.object({ token: z.string().min(1), gameKey: drawingGameKeySchema, name: z.string().min(1), description: z.string().optional() }))
    .mutation(async ({ input }) => {
      const hostId = await requireHostId(input.token);
      try {
        return await createDrawingPlaylist(hostId, input.gameKey, input.name, input.description);
      } catch (error) {
        throw toContentTRPCError(error);
      }
    }),

  /** Full prompt list, ownership-checked, plus `inUse`/`readiness` — same shape/purpose as contentRouter.ts's/contentGeoRouter.ts's own playlist.get. */
  get: publicProcedure.input(z.object({ token: z.string().min(1), playlistId: z.string().min(1) })).query(async ({ input }) => {
    const hostId = await requireHostId(input.token);
    try {
      const [playlist, inUse] = await Promise.all([
        getOwnedDrawingPlaylist(hostId, input.playlistId),
        isDrawingPlaylistInUse(input.playlistId),
      ]);
      return { ...playlist, inUse, readiness: getDrawingPlaylistReadiness(playlist.prompts) };
    } catch (error) {
      throw toContentTRPCError(error);
    }
  }),

  update: publicProcedure
    .input(z.object({ token: z.string().min(1), playlistId: z.string().min(1), name: z.string().optional(), description: z.string().nullable().optional() }))
    .mutation(async ({ input }) => {
      const hostId = await requireHostId(input.token);
      try {
        return await updateDrawingPlaylist(hostId, input.playlistId, { name: input.name, description: input.description });
      } catch (error) {
        throw toContentTRPCError(error);
      }
    }),

  delete: publicProcedure.input(z.object({ token: z.string().min(1), playlistId: z.string().min(1) })).mutation(async ({ input }) => {
    const hostId = await requireHostId(input.token);
    try {
      await deleteDrawingPlaylist(hostId, input.playlistId);
      return { ok: true as const };
    } catch (error) {
      throw toContentTRPCError(error);
    }
  }),

  duplicate: publicProcedure.input(z.object({ token: z.string().min(1), playlistId: z.string().min(1) })).mutation(async ({ input }) => {
    const hostId = await requireHostId(input.token);
    try {
      return await duplicateDrawingPlaylist(hostId, input.playlistId);
    } catch (error) {
      throw toContentTRPCError(error);
    }
  }),
});

const promptInputShape = {
  text: z.string().nullable().optional(),
  durationSeconds: z.number().int().positive().optional(),
};

const drawingPromptRouter = router({
  create: publicProcedure
    .input(z.object({ token: z.string().min(1), playlistId: z.string().min(1), text: z.string().optional() }))
    .mutation(async ({ input }) => {
      const hostId = await requireHostId(input.token);
      try {
        return await createPrompt(hostId, input.playlistId, input.text);
      } catch (error) {
        throw toContentTRPCError(error);
      }
    }),

  /** Sets text/durationSeconds on an existing prompt. */
  update: publicProcedure
    .input(z.object({ token: z.string().min(1), promptId: z.string().min(1), ...promptInputShape }))
    .mutation(async ({ input }) => {
      const hostId = await requireHostId(input.token);
      try {
        return await updatePrompt(hostId, input.promptId, { text: input.text, durationSeconds: input.durationSeconds });
      } catch (error) {
        throw toContentTRPCError(error);
      }
    }),

  delete: publicProcedure.input(z.object({ token: z.string().min(1), promptId: z.string().min(1) })).mutation(async ({ input }) => {
    const hostId = await requireHostId(input.token);
    try {
      await deletePrompt(hostId, input.promptId);
      return { ok: true as const };
    } catch (error) {
      throw toContentTRPCError(error);
    }
  }),

  /** Copies text/duration into a new prompt appended to the same playlist — see contentDrawing.ts's duplicatePrompt. */
  duplicate: publicProcedure.input(z.object({ token: z.string().min(1), promptId: z.string().min(1) })).mutation(async ({ input }) => {
    const hostId = await requireHostId(input.token);
    try {
      return await duplicatePrompt(hostId, input.promptId);
    } catch (error) {
      throw toContentTRPCError(error);
    }
  }),

  reorder: publicProcedure
    .input(z.object({ token: z.string().min(1), playlistId: z.string().min(1), orderedPromptIds: z.array(z.string().min(1)) }))
    .mutation(async ({ input }) => {
      const hostId = await requireHostId(input.token);
      try {
        await reorderPrompts(hostId, input.playlistId, input.orderedPromptIds);
        return { ok: true as const };
      } catch (error) {
        throw toContentTRPCError(error);
      }
    }),
});

export const contentDrawingRouter = router({
  playlist: drawingPlaylistRouter,
  prompt: drawingPromptRouter,
});
