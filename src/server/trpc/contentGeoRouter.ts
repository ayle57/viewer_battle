import { z } from "zod";
import { router, publicProcedure } from "@/server/trpc/trpc";
import { toContentTRPCError } from "@/server/trpc/contentErrors";
import { resolveContentHost } from "@/server/db/contentHost";
import {
  createGeoPlaylist,
  createRound,
  deleteGeoPlaylist,
  deleteRound,
  duplicateGeoPlaylist,
  getOwnedGeoPlaylist,
  isGeoPlaylistInUse,
  listGeoPlaylists,
  reorderRounds,
  updateGeoPlaylist,
  updateRound,
} from "@/server/db/contentGeo";
import { getGeoPlaylistReadiness } from "@/domain/content";
import { listGeoMapAssets } from "@/server/content/geoAssets";

/**
 * GeoGuessr's Content Studio tRPC surface — the geo counterpart to
 * contentRouter.ts's `playlist`/`category`/`question` routers, mounted
 * alongside them under the SAME top-level `content` router (see
 * router.ts) so both games share the one ContentHost identity/login
 * (`content.auth`) without a second sign-in flow. Kept in its own file/
 * router object rather than folded into contentRouter.ts's existing
 * routers — those are genuinely Jeopardy-shaped (category/question
 * inputs) and this pass's instruction is explicit: don't touch
 * Jeopardy's own procedures.
 *
 * Same auth/ownership posture throughout: every procedure re-derives
 * `hostId` from `token` (never trusts a client-supplied hostId), and
 * every src/server/db/contentGeo.ts query filters ownership directly in
 * the query — see that file's doc comment for why that's IDOR-safe.
 */
const geoGameKeySchema = z.literal("geoguessr");

async function requireHostId(token: string): Promise<string> {
  try {
    const { hostId } = await resolveContentHost(token);
    return hostId;
  } catch (error) {
    throw toContentTRPCError(error);
  }
}

const geoPlaylistRouter = router({
  list: publicProcedure.input(z.object({ token: z.string().min(1), gameKey: geoGameKeySchema })).query(async ({ input }) => {
    const hostId = await requireHostId(input.token);
    return listGeoPlaylists(hostId, input.gameKey);
  }),

  create: publicProcedure
    .input(z.object({ token: z.string().min(1), gameKey: geoGameKeySchema, name: z.string().min(1), description: z.string().optional() }))
    .mutation(async ({ input }) => {
      const hostId = await requireHostId(input.token);
      try {
        return await createGeoPlaylist(hostId, input.gameKey, input.name, input.description);
      } catch (error) {
        throw toContentTRPCError(error);
      }
    }),

  /** Full round list, ownership-checked, plus `inUse`/`readiness` — same shape/purpose as contentRouter.ts's playlist.get. */
  get: publicProcedure.input(z.object({ token: z.string().min(1), playlistId: z.string().min(1) })).query(async ({ input }) => {
    const hostId = await requireHostId(input.token);
    try {
      const [playlist, inUse] = await Promise.all([
        getOwnedGeoPlaylist(hostId, input.playlistId),
        isGeoPlaylistInUse(input.playlistId),
      ]);
      return { ...playlist, inUse, readiness: getGeoPlaylistReadiness(playlist.rounds) };
    } catch (error) {
      throw toContentTRPCError(error);
    }
  }),

  update: publicProcedure
    .input(z.object({ token: z.string().min(1), playlistId: z.string().min(1), name: z.string().optional(), description: z.string().nullable().optional() }))
    .mutation(async ({ input }) => {
      const hostId = await requireHostId(input.token);
      try {
        return await updateGeoPlaylist(hostId, input.playlistId, { name: input.name, description: input.description });
      } catch (error) {
        throw toContentTRPCError(error);
      }
    }),

  delete: publicProcedure.input(z.object({ token: z.string().min(1), playlistId: z.string().min(1) })).mutation(async ({ input }) => {
    const hostId = await requireHostId(input.token);
    try {
      await deleteGeoPlaylist(hostId, input.playlistId);
      return { ok: true as const };
    } catch (error) {
      throw toContentTRPCError(error);
    }
  }),

  duplicate: publicProcedure.input(z.object({ token: z.string().min(1), playlistId: z.string().min(1) })).mutation(async ({ input }) => {
    const hostId = await requireHostId(input.token);
    try {
      return await duplicateGeoPlaylist(hostId, input.playlistId);
    } catch (error) {
      throw toContentTRPCError(error);
    }
  }),
});

const roundInputShape = {
  title: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  question: z.string().nullable().optional(),
  targetX: z.number().min(0).max(1).nullable().optional(),
  targetY: z.number().min(0).max(1).nullable().optional(),
};

const geoRoundRouter = router({
  create: publicProcedure
    .input(z.object({ token: z.string().min(1), playlistId: z.string().min(1), title: z.string().optional() }))
    .mutation(async ({ input }) => {
      const hostId = await requireHostId(input.token);
      try {
        return await createRound(hostId, input.playlistId, input.title);
      } catch (error) {
        throw toContentTRPCError(error);
      }
    }),

  /** Sets image/question/target/title on an existing round — the click-on-the-map save (RoundEditorDialog) sends `targetX`/`targetY` together, always; sending only one is rejected server-side (see contentGeo.ts's validateRoundInput). */
  update: publicProcedure
    .input(z.object({ token: z.string().min(1), roundId: z.string().min(1), ...roundInputShape }))
    .mutation(async ({ input }) => {
      const hostId = await requireHostId(input.token);
      try {
        return await updateRound(hostId, input.roundId, {
          title: input.title,
          imageUrl: input.imageUrl,
          question: input.question,
          targetX: input.targetX,
          targetY: input.targetY,
        });
      } catch (error) {
        throw toContentTRPCError(error);
      }
    }),

  delete: publicProcedure.input(z.object({ token: z.string().min(1), roundId: z.string().min(1) })).mutation(async ({ input }) => {
    const hostId = await requireHostId(input.token);
    try {
      await deleteRound(hostId, input.roundId);
      return { ok: true as const };
    } catch (error) {
      throw toContentTRPCError(error);
    }
  }),

  reorder: publicProcedure
    .input(z.object({ token: z.string().min(1), playlistId: z.string().min(1), orderedRoundIds: z.array(z.string().min(1)) }))
    .mutation(async ({ input }) => {
      const hostId = await requireHostId(input.token);
      try {
        await reorderRounds(hostId, input.playlistId, input.orderedRoundIds);
        return { ok: true as const };
      } catch (error) {
        throw toContentTRPCError(error);
      }
    }),
});

/** Read-only — see src/server/content/geoAssets.ts for why this lists a folder instead of a real upload system. No `token` required: this isn't Host-owned content, it's the shared pool of available map images every Host picks from (same posture as a stock asset library would have). */
const geoAssetRouter = router({
  list: publicProcedure.query(async () => listGeoMapAssets()),
});

export const contentGeoRouter = router({
  playlist: geoPlaylistRouter,
  round: geoRoundRouter,
  asset: geoAssetRouter,
});
