import { z } from "zod";
import { router, publicProcedure } from "@/server/trpc/trpc";
import { toContentTRPCError } from "@/server/trpc/contentErrors";
import { resolveContentHost } from "@/server/db/contentHost";
import {
  createPriceItem,
  createPricePlaylist,
  deletePriceItem,
  deletePricePlaylist,
  duplicatePriceItem,
  duplicatePricePlaylist,
  getOwnedPricePlaylist,
  isPricePlaylistInUse,
  listPricePlaylists,
  reorderPriceItems,
  updatePriceItem,
  updatePricePlaylist,
} from "@/server/db/contentPrice";
import { getGuessThePricePlaylistReadiness } from "@/domain/content";
import { deletePriceAsset, listPriceAssets } from "@/server/content/priceAssets";

/**
 * "Guess the Price" Content Studio tRPC surface — the Guess-the-Price
 * counterpart to contentRouter.ts's `playlist`/`category`/`question`
 * routers, contentGeoRouter.ts's/contentDrawingRouter.ts's/
 * contentMusicRouter.ts's/contentSteamRouter.ts's own routers, mounted
 * alongside all five under the SAME top-level `content` router (see
 * router.ts) so every game shares the one ContentHost identity/login
 * (`content.auth`) without a second sign-in flow. Kept in its own file,
 * same reasoning as the other games' routers: don't touch any other
 * game's own procedures.
 *
 * Same auth/ownership posture throughout: every procedure re-derives
 * `hostId` from `token` (never trusts a client-supplied hostId), and
 * every src/server/db/contentPrice.ts query filters ownership directly
 * in the query — see that file's doc comment for why that's IDOR-safe.
 */
const priceGameKeySchema = z.literal("guessThePrice");

async function requireHostId(token: string): Promise<string> {
  try {
    const { hostId } = await resolveContentHost(token);
    return hostId;
  } catch (error) {
    throw toContentTRPCError(error);
  }
}

const pricePlaylistRouter = router({
  list: publicProcedure.input(z.object({ token: z.string().min(1), gameKey: priceGameKeySchema })).query(async ({ input }) => {
    const hostId = await requireHostId(input.token);
    return listPricePlaylists(hostId, input.gameKey);
  }),

  create: publicProcedure
    .input(z.object({ token: z.string().min(1), gameKey: priceGameKeySchema, name: z.string().min(1), description: z.string().optional() }))
    .mutation(async ({ input }) => {
      const hostId = await requireHostId(input.token);
      try {
        return await createPricePlaylist(hostId, input.gameKey, input.name, input.description);
      } catch (error) {
        throw toContentTRPCError(error);
      }
    }),

  /** Full item list, ownership-checked, plus `inUse`/`readiness` — same shape/purpose as the other games' own playlist.get. */
  get: publicProcedure.input(z.object({ token: z.string().min(1), playlistId: z.string().min(1) })).query(async ({ input }) => {
    const hostId = await requireHostId(input.token);
    try {
      const [playlist, inUse] = await Promise.all([
        getOwnedPricePlaylist(hostId, input.playlistId),
        isPricePlaylistInUse(input.playlistId),
      ]);
      return { ...playlist, inUse, readiness: getGuessThePricePlaylistReadiness(playlist.priceItems) };
    } catch (error) {
      throw toContentTRPCError(error);
    }
  }),

  update: publicProcedure
    .input(z.object({ token: z.string().min(1), playlistId: z.string().min(1), name: z.string().optional(), description: z.string().nullable().optional() }))
    .mutation(async ({ input }) => {
      const hostId = await requireHostId(input.token);
      try {
        return await updatePricePlaylist(hostId, input.playlistId, { name: input.name, description: input.description });
      } catch (error) {
        throw toContentTRPCError(error);
      }
    }),

  delete: publicProcedure.input(z.object({ token: z.string().min(1), playlistId: z.string().min(1) })).mutation(async ({ input }) => {
    const hostId = await requireHostId(input.token);
    try {
      await deletePricePlaylist(hostId, input.playlistId);
      return { ok: true as const };
    } catch (error) {
      throw toContentTRPCError(error);
    }
  }),

  duplicate: publicProcedure.input(z.object({ token: z.string().min(1), playlistId: z.string().min(1) })).mutation(async ({ input }) => {
    const hostId = await requireHostId(input.token);
    try {
      return await duplicatePricePlaylist(hostId, input.playlistId);
    } catch (error) {
      throw toContentTRPCError(error);
    }
  }),
});

const itemInputShape = {
  title: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  price: z.number().positive().finite().nullable().optional(),
  marginPercent: z.number().min(0).max(100).nullable().optional(),
};

const priceItemRouter = router({
  create: publicProcedure
    .input(z.object({ token: z.string().min(1), playlistId: z.string().min(1), title: z.string().optional() }))
    .mutation(async ({ input }) => {
      const hostId = await requireHostId(input.token);
      try {
        return await createPriceItem(hostId, input.playlistId, input.title);
      } catch (error) {
        throw toContentTRPCError(error);
      }
    }),

  /** Sets title/imageUrl/price/marginPercent on an existing item — this is how the editor's own local buffer is saved; see ItemEditorPanel.tsx. */
  update: publicProcedure
    .input(z.object({ token: z.string().min(1), itemId: z.string().min(1), ...itemInputShape }))
    .mutation(async ({ input }) => {
      const hostId = await requireHostId(input.token);
      try {
        return await updatePriceItem(hostId, input.itemId, {
          title: input.title,
          imageUrl: input.imageUrl,
          price: input.price,
          marginPercent: input.marginPercent,
        });
      } catch (error) {
        throw toContentTRPCError(error);
      }
    }),

  delete: publicProcedure.input(z.object({ token: z.string().min(1), itemId: z.string().min(1) })).mutation(async ({ input }) => {
    const hostId = await requireHostId(input.token);
    try {
      await deletePriceItem(hostId, input.itemId);
      return { ok: true as const };
    } catch (error) {
      throw toContentTRPCError(error);
    }
  }),

  /** Copies title/imageUrl/price/marginPercent into a new item appended to the same playlist — see contentPrice.ts's duplicatePriceItem for why copying the image REFERENCE is safe. Useful for a Host preparing several rounds off the same base photo. */
  duplicate: publicProcedure.input(z.object({ token: z.string().min(1), itemId: z.string().min(1) })).mutation(async ({ input }) => {
    const hostId = await requireHostId(input.token);
    try {
      return await duplicatePriceItem(hostId, input.itemId);
    } catch (error) {
      throw toContentTRPCError(error);
    }
  }),

  reorder: publicProcedure
    .input(z.object({ token: z.string().min(1), playlistId: z.string().min(1), orderedItemIds: z.array(z.string().min(1)) }))
    .mutation(async ({ input }) => {
      const hostId = await requireHostId(input.token);
      try {
        await reorderPriceItems(hostId, input.playlistId, input.orderedItemIds);
        return { ok: true as const };
      } catch (error) {
        throw toContentTRPCError(error);
      }
    }),
});

const priceAssetRouter = router({
  /** Read-only — see src/server/content/priceAssets.ts for why this lists a folder instead of real object storage. No `token` required: this isn't Host-owned content, it's the shared pool of available photos every Host picks from (same posture as steamAssetRouter's own `list`). */
  list: publicProcedure.query(async () => listPriceAssets()),

  /** Removes a photo from that shared pool — gated behind a real ContentHost token ("le streamer seulement"), unlike `list` above: this is a destructive write, not a read of a shared library. */
  delete: publicProcedure.input(z.object({ token: z.string().min(1), url: z.string().min(1) })).mutation(async ({ input }) => {
    await requireHostId(input.token);
    try {
      await deletePriceAsset(input.url);
      return { ok: true as const };
    } catch (error) {
      throw toContentTRPCError(error);
    }
  }),
});

export const contentPriceRouter = router({
  playlist: pricePlaylistRouter,
  item: priceItemRouter,
  asset: priceAssetRouter,
});
