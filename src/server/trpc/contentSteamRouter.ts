import { z } from "zod";
import { router, publicProcedure } from "@/server/trpc/trpc";
import { toContentTRPCError } from "@/server/trpc/contentErrors";
import { resolveContentHost } from "@/server/db/contentHost";
import {
  createSteamGame,
  createSteamPlaylist,
  deleteSteamGame,
  deleteSteamPlaylist,
  duplicateSteamGame,
  duplicateSteamPlaylist,
  getOwnedSteamPlaylist,
  isSteamPlaylistInUse,
  listSteamPlaylists,
  reorderSteamGames,
  updateSteamGame,
  updateSteamPlaylist,
} from "@/server/db/contentSteam";
import { getSteamRatingsPlaylistReadiness } from "@/domain/content";
import { deleteSteamCoverAsset, listSteamCoverAssets } from "@/server/content/steamAssets";

/**
 * "Guess the Game" (Steam Ratings) Content Studio tRPC surface — the
 * Steam-Ratings counterpart to contentRouter.ts's `playlist`/`category`/
 * `question` routers, contentGeoRouter.ts's own routers,
 * contentDrawingRouter.ts's own routers, and contentMusicRouter.ts's own
 * routers, mounted alongside all four under the SAME top-level `content`
 * router (see router.ts) so every game shares the one ContentHost
 * identity/login (`content.auth`) without a second sign-in flow. Kept in
 * its own file, same reasoning as the other games' routers: don't touch
 * any other game's own procedures.
 *
 * Same auth/ownership posture throughout: every procedure re-derives
 * `hostId` from `token` (never trusts a client-supplied hostId), and
 * every src/server/db/contentSteam.ts query filters ownership directly
 * in the query — see that file's doc comment for why that's IDOR-safe.
 */
const steamGameKeySchema = z.literal("steamRatings");

async function requireHostId(token: string): Promise<string> {
  try {
    const { hostId } = await resolveContentHost(token);
    return hostId;
  } catch (error) {
    throw toContentTRPCError(error);
  }
}

const steamPlaylistRouter = router({
  list: publicProcedure.input(z.object({ token: z.string().min(1), gameKey: steamGameKeySchema })).query(async ({ input }) => {
    const hostId = await requireHostId(input.token);
    return listSteamPlaylists(hostId, input.gameKey);
  }),

  create: publicProcedure
    .input(z.object({ token: z.string().min(1), gameKey: steamGameKeySchema, name: z.string().min(1), description: z.string().optional() }))
    .mutation(async ({ input }) => {
      const hostId = await requireHostId(input.token);
      try {
        return await createSteamPlaylist(hostId, input.gameKey, input.name, input.description);
      } catch (error) {
        throw toContentTRPCError(error);
      }
    }),

  /** Full game list, ownership-checked, plus `inUse`/`readiness` — same shape/purpose as the other games' own playlist.get. */
  get: publicProcedure.input(z.object({ token: z.string().min(1), playlistId: z.string().min(1) })).query(async ({ input }) => {
    const hostId = await requireHostId(input.token);
    try {
      const [playlist, inUse] = await Promise.all([
        getOwnedSteamPlaylist(hostId, input.playlistId),
        isSteamPlaylistInUse(input.playlistId),
      ]);
      return { ...playlist, inUse, readiness: getSteamRatingsPlaylistReadiness(playlist.steamGames) };
    } catch (error) {
      throw toContentTRPCError(error);
    }
  }),

  update: publicProcedure
    .input(z.object({ token: z.string().min(1), playlistId: z.string().min(1), name: z.string().optional(), description: z.string().nullable().optional() }))
    .mutation(async ({ input }) => {
      const hostId = await requireHostId(input.token);
      try {
        return await updateSteamPlaylist(hostId, input.playlistId, { name: input.name, description: input.description });
      } catch (error) {
        throw toContentTRPCError(error);
      }
    }),

  delete: publicProcedure.input(z.object({ token: z.string().min(1), playlistId: z.string().min(1) })).mutation(async ({ input }) => {
    const hostId = await requireHostId(input.token);
    try {
      await deleteSteamPlaylist(hostId, input.playlistId);
      return { ok: true as const };
    } catch (error) {
      throw toContentTRPCError(error);
    }
  }),

  duplicate: publicProcedure.input(z.object({ token: z.string().min(1), playlistId: z.string().min(1) })).mutation(async ({ input }) => {
    const hostId = await requireHostId(input.token);
    try {
      return await duplicateSteamPlaylist(hostId, input.playlistId);
    } catch (error) {
      throw toContentTRPCError(error);
    }
  }),
});

const gameInputShape = {
  title: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  ratings: z.array(z.string()).max(10).optional(),
};

const steamGameRouter = router({
  create: publicProcedure
    .input(z.object({ token: z.string().min(1), playlistId: z.string().min(1), title: z.string().optional() }))
    .mutation(async ({ input }) => {
      const hostId = await requireHostId(input.token);
      try {
        return await createSteamGame(hostId, input.playlistId, input.title);
      } catch (error) {
        throw toContentTRPCError(error);
      }
    }),

  /** Sets title/imageUrl/ratings on an existing game — `ratings`, when present, REPLACES the whole array (this is how the editor's own local ordered-list buffer is saved; see GameEditorPanel.tsx). */
  update: publicProcedure
    .input(z.object({ token: z.string().min(1), gameId: z.string().min(1), ...gameInputShape }))
    .mutation(async ({ input }) => {
      const hostId = await requireHostId(input.token);
      try {
        return await updateSteamGame(hostId, input.gameId, { title: input.title, imageUrl: input.imageUrl, ratings: input.ratings });
      } catch (error) {
        throw toContentTRPCError(error);
      }
    }),

  delete: publicProcedure.input(z.object({ token: z.string().min(1), gameId: z.string().min(1) })).mutation(async ({ input }) => {
    const hostId = await requireHostId(input.token);
    try {
      await deleteSteamGame(hostId, input.gameId);
      return { ok: true as const };
    } catch (error) {
      throw toContentTRPCError(error);
    }
  }),

  /** Copies title/imageUrl/ratings into a new game appended to the same playlist — see contentSteam.ts's duplicateSteamGame for why copying the image REFERENCE is safe. Useful for a Host preparing several rounds off the same base cover. */
  duplicate: publicProcedure.input(z.object({ token: z.string().min(1), gameId: z.string().min(1) })).mutation(async ({ input }) => {
    const hostId = await requireHostId(input.token);
    try {
      return await duplicateSteamGame(hostId, input.gameId);
    } catch (error) {
      throw toContentTRPCError(error);
    }
  }),

  reorder: publicProcedure
    .input(z.object({ token: z.string().min(1), playlistId: z.string().min(1), orderedGameIds: z.array(z.string().min(1)) }))
    .mutation(async ({ input }) => {
      const hostId = await requireHostId(input.token);
      try {
        await reorderSteamGames(hostId, input.playlistId, input.orderedGameIds);
        return { ok: true as const };
      } catch (error) {
        throw toContentTRPCError(error);
      }
    }),
});

const steamAssetRouter = router({
  /** Read-only — see src/server/content/steamAssets.ts for why this lists a folder instead of real object storage. No `token` required: this isn't Host-owned content, it's the shared pool of available cover images every Host picks from (same posture as geoAssetRouter's own `list`). */
  list: publicProcedure.query(async () => listSteamCoverAssets()),

  /** Removes a cover from that shared pool — gated behind a real ContentHost token ("le streamer seulement"), unlike `list` above: this is a destructive write, not a read of a shared library. */
  delete: publicProcedure.input(z.object({ token: z.string().min(1), url: z.string().min(1) })).mutation(async ({ input }) => {
    await requireHostId(input.token);
    try {
      await deleteSteamCoverAsset(input.url);
      return { ok: true as const };
    } catch (error) {
      throw toContentTRPCError(error);
    }
  }),
});

export const contentSteamRouter = router({
  playlist: steamPlaylistRouter,
  game: steamGameRouter,
  asset: steamAssetRouter,
});
