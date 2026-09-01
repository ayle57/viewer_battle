import { z } from "zod";
import { router, publicProcedure } from "@/server/trpc/trpc";
import { toContentTRPCError } from "@/server/trpc/contentErrors";
import { resolveContentHost } from "@/server/db/contentHost";
import {
  createMusicPlaylist,
  createTrack,
  deleteMusicPlaylist,
  deleteTrack,
  duplicateMusicPlaylist,
  duplicateTrack,
  getOwnedMusicPlaylist,
  isMusicPlaylistInUse,
  listMusicPlaylists,
  reorderTracks,
  updateMusicPlaylist,
  updateTrack,
} from "@/server/db/contentMusic";
import { getMusicPlaylistReadiness } from "@/domain/content";
import { deleteMusicAudioAsset, listMusicAudioAssets } from "@/server/content/musicAssets";

/**
 * Music's ("Guess the Music") Content Studio tRPC surface — the Music
 * counterpart to contentRouter.ts's `playlist`/`category`/`question`
 * routers, contentGeoRouter.ts's `playlist`/`round`/`asset` routers, and
 * contentDrawingRouter.ts's `playlist`/`prompt` routers, mounted
 * alongside all three under the SAME top-level `content` router (see
 * router.ts) so every game shares the one ContentHost identity/login
 * (`content.auth`) without a second sign-in flow. Kept in its own file,
 * same reasoning as the other games' routers: don't touch any other
 * game's own procedures.
 *
 * Same auth/ownership posture throughout: every procedure re-derives
 * `hostId` from `token` (never trusts a client-supplied hostId), and
 * every src/server/db/contentMusic.ts query filters ownership directly
 * in the query — see that file's doc comment for why that's IDOR-safe.
 */
const musicGameKeySchema = z.literal("music");

async function requireHostId(token: string): Promise<string> {
  try {
    const { hostId } = await resolveContentHost(token);
    return hostId;
  } catch (error) {
    throw toContentTRPCError(error);
  }
}

const musicPlaylistRouter = router({
  list: publicProcedure.input(z.object({ token: z.string().min(1), gameKey: musicGameKeySchema })).query(async ({ input }) => {
    const hostId = await requireHostId(input.token);
    return listMusicPlaylists(hostId, input.gameKey);
  }),

  create: publicProcedure
    .input(z.object({ token: z.string().min(1), gameKey: musicGameKeySchema, name: z.string().min(1), description: z.string().optional() }))
    .mutation(async ({ input }) => {
      const hostId = await requireHostId(input.token);
      try {
        return await createMusicPlaylist(hostId, input.gameKey, input.name, input.description);
      } catch (error) {
        throw toContentTRPCError(error);
      }
    }),

  /** Full track list, ownership-checked, plus `inUse`/`readiness` — same shape/purpose as the other games' own playlist.get. */
  get: publicProcedure.input(z.object({ token: z.string().min(1), playlistId: z.string().min(1) })).query(async ({ input }) => {
    const hostId = await requireHostId(input.token);
    try {
      const [playlist, inUse] = await Promise.all([
        getOwnedMusicPlaylist(hostId, input.playlistId),
        isMusicPlaylistInUse(input.playlistId),
      ]);
      return { ...playlist, inUse, readiness: getMusicPlaylistReadiness(playlist.tracks) };
    } catch (error) {
      throw toContentTRPCError(error);
    }
  }),

  update: publicProcedure
    .input(z.object({ token: z.string().min(1), playlistId: z.string().min(1), name: z.string().optional(), description: z.string().nullable().optional() }))
    .mutation(async ({ input }) => {
      const hostId = await requireHostId(input.token);
      try {
        return await updateMusicPlaylist(hostId, input.playlistId, { name: input.name, description: input.description });
      } catch (error) {
        throw toContentTRPCError(error);
      }
    }),

  delete: publicProcedure.input(z.object({ token: z.string().min(1), playlistId: z.string().min(1) })).mutation(async ({ input }) => {
    const hostId = await requireHostId(input.token);
    try {
      await deleteMusicPlaylist(hostId, input.playlistId);
      return { ok: true as const };
    } catch (error) {
      throw toContentTRPCError(error);
    }
  }),

  duplicate: publicProcedure.input(z.object({ token: z.string().min(1), playlistId: z.string().min(1) })).mutation(async ({ input }) => {
    const hostId = await requireHostId(input.token);
    try {
      return await duplicateMusicPlaylist(hostId, input.playlistId);
    } catch (error) {
      throw toContentTRPCError(error);
    }
  }),
});

const trackInputShape = {
  audioUrl: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  artist: z.string().nullable().optional(),
};

const musicTrackRouter = router({
  create: publicProcedure
    .input(z.object({ token: z.string().min(1), playlistId: z.string().min(1), title: z.string().optional() }))
    .mutation(async ({ input }) => {
      const hostId = await requireHostId(input.token);
      try {
        return await createTrack(hostId, input.playlistId, input.title);
      } catch (error) {
        throw toContentTRPCError(error);
      }
    }),

  /** Sets audioUrl/title/artist on an existing track. */
  update: publicProcedure
    .input(z.object({ token: z.string().min(1), trackId: z.string().min(1), ...trackInputShape }))
    .mutation(async ({ input }) => {
      const hostId = await requireHostId(input.token);
      try {
        return await updateTrack(hostId, input.trackId, { audioUrl: input.audioUrl, title: input.title, artist: input.artist });
      } catch (error) {
        throw toContentTRPCError(error);
      }
    }),

  delete: publicProcedure.input(z.object({ token: z.string().min(1), trackId: z.string().min(1) })).mutation(async ({ input }) => {
    const hostId = await requireHostId(input.token);
    try {
      await deleteTrack(hostId, input.trackId);
      return { ok: true as const };
    } catch (error) {
      throw toContentTRPCError(error);
    }
  }),

  /** Copies audio/title/artist into a new track appended to the same playlist — see contentMusic.ts's duplicateTrack for why copying the audio REFERENCE is safe. Useful for a Host preparing several rounds off the same base clip. */
  duplicate: publicProcedure.input(z.object({ token: z.string().min(1), trackId: z.string().min(1) })).mutation(async ({ input }) => {
    const hostId = await requireHostId(input.token);
    try {
      return await duplicateTrack(hostId, input.trackId);
    } catch (error) {
      throw toContentTRPCError(error);
    }
  }),

  reorder: publicProcedure
    .input(z.object({ token: z.string().min(1), playlistId: z.string().min(1), orderedTrackIds: z.array(z.string().min(1)) }))
    .mutation(async ({ input }) => {
      const hostId = await requireHostId(input.token);
      try {
        await reorderTracks(hostId, input.playlistId, input.orderedTrackIds);
        return { ok: true as const };
      } catch (error) {
        throw toContentTRPCError(error);
      }
    }),
});

const musicAssetRouter = router({
  /** Read-only — see src/server/content/musicAssets.ts for why this lists a folder instead of real object storage. No `token` required: this isn't Host-owned content, it's the shared pool of available audio clips every Host picks from (same posture as geoAssetRouter's own `list`). */
  list: publicProcedure.query(async () => listMusicAudioAssets()),

  /** Removes a clip from that shared pool — gated behind a real ContentHost token ("le streamer seulement"), unlike `list` above: this is a destructive write, not a read of a shared library. */
  delete: publicProcedure.input(z.object({ token: z.string().min(1), url: z.string().min(1) })).mutation(async ({ input }) => {
    await requireHostId(input.token);
    try {
      await deleteMusicAudioAsset(input.url);
      return { ok: true as const };
    } catch (error) {
      throw toContentTRPCError(error);
    }
  }),
});

export const contentMusicRouter = router({
  playlist: musicPlaylistRouter,
  track: musicTrackRouter,
  asset: musicAssetRouter,
});
