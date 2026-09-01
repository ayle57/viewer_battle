import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "@/server/trpc/trpc";
import { toTRPCError } from "@/server/trpc/errors";
import { prisma } from "@/server/db/client";
import { createSession, endSession, getSessionState, rotateSessionCode } from "@/server/db/session";
import { joinSession, kickParticipant, reclaimHost, resolveParticipantByToken, findActiveHostSessionForAccount, reclaimHostByAccount } from "@/server/db/participant";
import { joinSessionInputSchema, reclaimHostInputSchema, sessionCodeSchema, SessionError } from "@/domain/session";
import { verifyHostPassword } from "@/server/auth/hostPassword";
import { sampleBoard } from "@/domain/game/boardQuestion";
import { sampleGeoPlaylist } from "@/domain/game/geoGuessr";
import { sampleDrawingPlaylist } from "@/domain/game/drawing";
import { sampleMusicPlaylist } from "@/domain/game/music";
import { sampleSteamRatingsPlaylist } from "@/domain/game/steamRatings";
import { sampleGuessThePricePlaylist } from "@/domain/game/guessThePrice";
import { gameKeySchema } from "@/domain/game";
import {
  ContentError,
  getDrawingPlaylistReadiness,
  getGeoPlaylistReadiness,
  getMusicPlaylistReadiness,
  getPlaylistReadiness,
  getSteamRatingsPlaylistReadiness,
  getGuessThePricePlaylistReadiness,
  playlistToBoardQuestionConfig,
  playlistToDrawingConfig,
  playlistToGeoGuessrConfig,
  playlistToMusicConfig,
  playlistToSteamRatingsConfig,
  playlistToGuessThePriceConfig,
} from "@/domain/content";
import { startGame } from "@/server/game";
import { broadcastGameSnapshot } from "@/server/sockets/game";
import { broadcastParticipantKicked, broadcastSessionCodeRotated, broadcastSessionEnded } from "@/server/sockets/session";
import { getSocketServer } from "@/server/sockets/instance";
import { isHostConnected } from "@/server/sockets/presence";
import { getOwnedPlaylist } from "@/server/db/content";
import { getOwnedGeoPlaylist } from "@/server/db/contentGeo";
import { getOwnedDrawingPlaylist } from "@/server/db/contentDrawing";
import { getOwnedMusicPlaylist } from "@/server/db/contentMusic";
import { getOwnedSteamPlaylist } from "@/server/db/contentSteam";
import { getOwnedPricePlaylist } from "@/server/db/contentPrice";
import { resolveContentHost } from "@/server/db/contentHost";
import { toContentTRPCError } from "@/server/trpc/contentErrors";
import { contentRouter } from "@/server/trpc/contentRouter";
import { userRouter } from "@/server/trpc/userRouter";
import { adminRouter } from "@/server/trpc/adminRouter";
import { resolveAdminUserByToken } from "@/server/db/user";
import { toUserTRPCError } from "@/server/trpc/userErrors";

/**
 * system.health: a real DB reachability check, consumed by the /dev
 * playground's landing page service-status panel. Deliberately not the
 * Phase 0 spike's health.check shape (see AGENTS.md) — this one does a
 * real query and has a real caller.
 */
const systemRouter = router({
  health: publicProcedure.query(async () => {
    const dbOk = await prisma.$queryRaw`SELECT 1`
      .then(() => true)
      .catch(() => false);
    return { dbOk, timestamp: new Date().toISOString() };
  }),
});

/**
 * Real session management — see AGENTS.md "Session invariants". Every
 * procedure here goes through src/server/db (session.ts / participant.ts),
 * the same functions Socket.IO's auth middleware uses to resolve a token
 * (src/server/auth) — the capacity/role rules and the token resolution
 * live in exactly one place, not duplicated per transport.
 */
const sessionRouter = router({
  /**
   * Gated behind HOST_PASSWORD (src/server/auth/hostPassword.ts) OR a
   * real `isAdmin` account (`accountToken` — src/server/db/user.ts's
   * `resolveAdminUserByToken`, see that file's own doc comment) — this
   * app runs one specific streamer's show, so creating a new game at all
   * requires proving you're that operator, checked before anything is
   * written to the DB. Two ways to prove the SAME thing, not two
   * separate permissions: `accountToken` is purely additive (the real
   * product's own /host page now uses it exclusively, having already
   * gated the whole page behind an account login — see host/page.tsx's
   * own doc comment), while `hostPassword` keeps working byte-for-byte
   * unchanged for the /dev playground and anything else that already
   * sends it. At least one is required; `accountToken` is checked first
   * since a real, resolved identity is a stronger signal than a shared
   * secret, but either one alone is sufficient. Separate concern from
   * the per-session host recovery key returned below: this proves "I'm
   * allowed to start a show," the recovery key proves "I'm the same host
   * who already started THIS one."
   */
  create: publicProcedure
    .input(z.object({ hostPassword: z.string().min(1).optional(), accountToken: z.string().min(1).optional() }))
    .mutation(async ({ input }) => {
      if (input.accountToken) {
        try {
          await resolveAdminUserByToken(input.accountToken);
        } catch (error) {
          throw toUserTRPCError(error);
        }
      } else if (!input.hostPassword || !verifyHostPassword(input.hostPassword)) {
        throw toTRPCError(new SessionError("INVALID_HOST_PASSWORD"));
      }
      const session = await createSession();
      // hostKey is plaintext and one-time — the client shows it to the host
      // exactly once (see /host's SaveHostKey step) and never receives it
      // again; only its hash is ever persisted (Session.hostKeyHash).
      return { code: session.code, status: session.status, hostKey: session.hostKey };
    }),

  join: publicProcedure.input(joinSessionInputSchema).mutation(async ({ input }) => {
    try {
      return await joinSession(input);
    } catch (error) {
      throw toTRPCError(error);
    }
  }),

  /** The recovery path when the host lost their token — see reclaimHost in src/server/db/participant.ts. */
  reclaimHost: publicProcedure.input(reclaimHostInputSchema).mutation(async ({ input }) => {
    try {
      return await reclaimHost(input);
    } catch (error) {
      throw toTRPCError(error);
    }
  }),

  /** Powers /host's "Resume your show" shortcut — see findActiveHostSessionForAccount's own doc comment. `null`, never an error, when there's nothing to resume. */
  resumeByAccount: publicProcedure.input(z.object({ accountToken: z.string().min(1) })).query(async ({ input }) => {
    return findActiveHostSessionForAccount(input.accountToken);
  }),

  /** The mutation half — see reclaimHostByAccount's own doc comment. */
  reclaimByAccount: publicProcedure.input(z.object({ accountToken: z.string().min(1) })).mutation(async ({ input }) => {
    try {
      return await reclaimHostByAccount(input.accountToken);
    } catch (error) {
      throw toTRPCError(error);
    }
  }),

  getState: publicProcedure.input(z.object({ sessionCode: sessionCodeSchema })).query(async ({ input }) => {
    try {
      return await getSessionState(input.sessionCode);
    } catch (error) {
      throw toTRPCError(error);
    }
  }),

  /** Resolves the caller's own token back to who/what session they are — used to rehydrate an identity after a page reload without re-joining. */
  me: publicProcedure.input(z.object({ token: z.string().min(1) })).query(async ({ input }) => {
    try {
      const participant = await resolveParticipantByToken(input.token);
      return {
        sessionCode: participant.sessionCode,
        sessionStatus: participant.sessionStatus,
        role: participant.role,
        displayName: participant.displayName,
      };
    } catch (error) {
      throw toTRPCError(error);
    }
  }),

  /**
   * Host-only: ends the session — a soft `status: FINISHED` update (see
   * `endSession` in src/server/db/session.ts), not a delete. Rejects
   * anyone whose token doesn't resolve to HOST in that session.
   * Broadcasts `session:ended` to every currently-connected client
   * BEFORE persisting the status flip, so Player/Display/other Host tabs
   * get a real-time notice instead of waiting on their next poll to see
   * `status: "FINISHED"`.
   */
  finish: publicProcedure.input(z.object({ token: z.string().min(1) })).mutation(async ({ input }) => {
    try {
      const participant = await resolveParticipantByToken(input.token);
      if (participant.role !== "HOST") throw new SessionError("FORBIDDEN");

      const io = getSocketServer();
      if (io) broadcastSessionEnded(io, participant.sessionId);

      await endSession(participant.sessionId);
      return { ok: true as const };
    } catch (error) {
      throw toTRPCError(error);
    }
  }),

  /**
   * Host-only: forcibly frees one seat (kickParticipant,
   * src/server/db/participant.ts — a real delete, unlike `finish` above;
   * see that function's own doc comment on why) AND rotates the
   * session's own join code in the same breath (rotateSessionCode,
   * src/server/db/session.ts) — a kick is meant to actually remove
   * someone, not just inconvenience them into rejoining under a new
   * name a second later with the same code they already know. Every
   * already-connected participant (including the Host's own other
   * tabs) keeps working through the rotation — they authenticate by
   * token, never by code (see rotateSessionCode's own doc comment) — so
   * `newSessionCode` is returned purely for the CALLING Host's own UI to
   * show/copy, not because anyone else needs to be told. Broadcasts
   * `participant:kicked` to exactly the kicked participant's own
   * socket(s) BEFORE disconnecting them (broadcastParticipantKicked,
   * src/server/sockets/session.ts) — everyone else in the session just
   * sees the seat go empty on the next `presence:update`, the same as
   * any other disconnect.
   */
  kick: publicProcedure
    .input(z.object({ token: z.string().min(1), participantId: z.string().min(1) }))
    .mutation(async ({ input }) => {
      try {
        const participant = await resolveParticipantByToken(input.token);
        if (participant.role !== "HOST") throw new SessionError("FORBIDDEN");

        const kicked = await kickParticipant(participant.sessionId, input.participantId);
        const newSessionCode = await rotateSessionCode(participant.sessionId);

        const io = getSocketServer();
        if (io) {
          broadcastParticipantKicked(io, input.participantId);
          // Real bug this closes — see broadcastSessionCodeRotated's own
          // doc comment: without this, every OTHER already-connected
          // participant (both teams, Display, any other Host tab) had
          // their own `session.getState` polling start 404ing the
          // instant this rotation happened, misread as "session ended."
          broadcastSessionCodeRotated(io, participant.sessionId, newSessionCode);
        }

        return { ok: true as const, ...kicked, newSessionCode };
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  /**
   * Host-only, self-service version of the same rotation `kick` does
   * automatically — "I think this code leaked, or I just want fewer
   * randoms able to join" without needing to kick anyone first. See
   * rotateSessionCode's own doc comment for why every already-connected
   * participant's SOCKET is unaffected, and broadcastSessionCodeRotated's
   * own doc comment for the real bug closed here: without that broadcast,
   * every OTHER already-connected client's own `session.getState`
   * POLLING (a separate thing from the socket) silently broke the
   * instant this ran.
   */
  rotateCode: publicProcedure.input(z.object({ token: z.string().min(1) })).mutation(async ({ input }) => {
    try {
      const participant = await resolveParticipantByToken(input.token);
      if (participant.role !== "HOST") throw new SessionError("FORBIDDEN");

      const newSessionCode = await rotateSessionCode(participant.sessionId);

      const io = getSocketServer();
      if (io) broadcastSessionCodeRotated(io, participant.sessionId, newSessionCode);

      return { ok: true as const, newSessionCode };
    } catch (error) {
      throw toTRPCError(error);
    }
  }),
});

/**
 * Starting a game is a one-time setup operation (create a SessionGame
 * row), so it's tRPC, not a socket event — matching the existing
 * tRPC-for-setup / Socket.IO-for-realtime split (AGENTS.md). Every
 * subsequent in-game action (SELECT_QUESTION, BUZZ, ...) goes through
 * `game:action` over the socket (src/server/sockets/game.ts), not here.
 */
/**
 * "Choose your content" (see AGENTS.md-equivalent write-up in
 * prisma/schema.prisma's "Content Studio" comment): a game either uses
 * the built-in sample board (unchanged — the literal default when
 * `content` is omitted, so every pre-existing caller/test keeps working
 * verbatim) or a Host-prepared Playlist, resolved and snapshotted
 * server-side. The client never sends board data itself — only an id — so
 * there's nothing here for a tampered request to inject.
 */
const gameStartContentSchema = z
  .discriminatedUnion("type", [
    z.object({ type: z.literal("sample") }),
    z.object({ type: z.literal("playlist"), playlistId: z.string().min(1), contentToken: z.string().min(1) }),
  ])
  .optional();

/**
 * Resolves a Host-selected Playlist into the exact engine config
 * `startGame` needs, for whichever game is starting — the ONE dispatch
 * point between Content Studio data and a specific engine's config shape
 * (mirrors how src/domain/game/registry.ts's `getGameEngine` is the one
 * dispatch point from a `gameKey` string to a specific engine), so
 * neither this file nor content.ts/contentGeo.ts need a scattered
 * `if (gameKey === "geoguessr")` anywhere else. Each branch re-uses the
 * SAME readiness check its own Content Studio surface already shows the
 * Host (getPlaylistReadiness / getGeoPlaylistReadiness) before ever
 * calling into `engine.createInitialState` — never a raw
 * INTERNAL_SERVER_ERROR from a `.parse()` throw on incomplete content,
 * always a real PLAYLIST_NOT_READY the Host can act on. Ownership is
 * resolved fresh from the ContentHost token on every call, the same
 * check Content Studio's own CRUD uses, so a Host can never start a game
 * off a Playlist that isn't theirs, even by guessing another host's id.
 */
async function resolveGameConfig(gameKey: string, content: { playlistId: string; contentToken: string }): Promise<{ config: unknown; playlistId: string }> {
  const { hostId } = await resolveContentHost(content.contentToken);
  if (gameKey === "geoguessr") {
    const playlist = await getOwnedGeoPlaylist(hostId, content.playlistId);
    const readiness = getGeoPlaylistReadiness(playlist.rounds);
    if (!readiness.ready) throw new ContentError("PLAYLIST_NOT_READY", readiness.summary);
    return { config: playlistToGeoGuessrConfig(playlist.rounds), playlistId: playlist.id };
  }
  if (gameKey === "drawing") {
    const playlist = await getOwnedDrawingPlaylist(hostId, content.playlistId);
    const readiness = getDrawingPlaylistReadiness(playlist.prompts);
    if (!readiness.ready) throw new ContentError("PLAYLIST_NOT_READY", readiness.summary);
    return { config: playlistToDrawingConfig(playlist.prompts), playlistId: playlist.id };
  }
  if (gameKey === "music") {
    const playlist = await getOwnedMusicPlaylist(hostId, content.playlistId);
    const readiness = getMusicPlaylistReadiness(playlist.tracks);
    if (!readiness.ready) throw new ContentError("PLAYLIST_NOT_READY", readiness.summary);
    return { config: playlistToMusicConfig(playlist.tracks), playlistId: playlist.id };
  }
  if (gameKey === "steamRatings") {
    const playlist = await getOwnedSteamPlaylist(hostId, content.playlistId);
    const readiness = getSteamRatingsPlaylistReadiness(playlist.steamGames);
    if (!readiness.ready) throw new ContentError("PLAYLIST_NOT_READY", readiness.summary);
    return { config: playlistToSteamRatingsConfig(playlist.steamGames), playlistId: playlist.id };
  }
  if (gameKey === "guessThePrice") {
    const playlist = await getOwnedPricePlaylist(hostId, content.playlistId);
    const readiness = getGuessThePricePlaylistReadiness(playlist.priceItems);
    if (!readiness.ready) throw new ContentError("PLAYLIST_NOT_READY", readiness.summary);
    return { config: playlistToGuessThePriceConfig(playlist.priceItems), playlistId: playlist.id };
  }
  const playlist = await getOwnedPlaylist(hostId, content.playlistId);
  const readiness = getPlaylistReadiness(playlist.categories);
  if (!readiness.ready) throw new ContentError("PLAYLIST_NOT_READY", readiness.summary);
  const questions = playlist.categories.flatMap((c) => c.questions);
  return { config: playlistToBoardQuestionConfig(playlist.categories, questions), playlistId: playlist.id };
}

/** The built-in sample content per engine, used when `content` is omitted or `{ type: "sample" }` — unchanged default for board-question (every pre-existing caller/test keeps working verbatim), sampleGeoPlaylist for geoguessr, sampleDrawingPlaylist for drawing, sampleMusicPlaylist for music, sampleSteamRatingsPlaylist for steamRatings, sampleGuessThePricePlaylist for guessThePrice. Pointing System has no Content Studio at all (`hasContentStudio` omitted, registry.ts) — `{}` is a perfectly complete config (its own `name` is optional, engine.ts's own DEFAULT_NAME fallback), this is just the one place every engine needs SOME config to reach through. */
function sampleConfigFor(gameKey: string): unknown {
  if (gameKey === "geoguessr") return sampleGeoPlaylist;
  if (gameKey === "drawing") return sampleDrawingPlaylist;
  if (gameKey === "music") return sampleMusicPlaylist;
  if (gameKey === "steamRatings") return sampleSteamRatingsPlaylist;
  if (gameKey === "guessThePrice") return sampleGuessThePricePlaylist;
  if (gameKey === "pointingSystem") return {};
  return sampleBoard;
}

const gameRouter = router({
  /**
   * HOST always; DISPLAY too, but sample content only — the one
   * deliberate exception to "Display never acts" (see display/page.tsx's
   * own doc comment), scoped to exactly one button: "start the next
   * game" once the current one has finished, with no content-picker UI
   * of its own to send a real Playlist selection through even if it
   * wanted to. `content` is force-ignored below for a DISPLAY caller
   * regardless of what the request actually carries — a tampered
   * request still can't start a Host's own prepared Playlist through
   * this door, only ever the built-in sample.
   */
  start: publicProcedure
    .input(z.object({ token: z.string().min(1), gameKey: gameKeySchema, content: gameStartContentSchema }))
    .mutation(async ({ input }) => {
      let participant;
      try {
        participant = await resolveParticipantByToken(input.token);
      } catch (error) {
        throw toTRPCError(error);
      }
      if (participant.role !== "HOST" && participant.role !== "DISPLAY") {
        throw toTRPCError(new SessionError("FORBIDDEN"));
      }
      // The DISPLAY-initiated "Start next game" is a convenience for
      // "no one's at the Host's keyboard right now" (see display/page.tsx's
      // own comment) — so it's only allowed while that's genuinely true.
      // With a Host connected, only the Host advances the show; this stops
      // anyone who joined as an (unauthenticated) DISPLAY during the
      // between-games window from forcing a sample-content replay.
      if (participant.role === "DISPLAY" && isHostConnected(participant.sessionId)) {
        throw toTRPCError(new SessionError("FORBIDDEN"));
      }
      const content = participant.role === "DISPLAY" ? undefined : input.content;

      let config: unknown = sampleConfigFor(input.gameKey);
      let playlistId: string | null = null;
      if (content?.type === "playlist") {
        try {
          const resolved = await resolveGameConfig(input.gameKey, content);
          config = resolved.config;
          playlistId = resolved.playlistId;
        } catch (error) {
          throw toContentTRPCError(error);
        }
      }

      const result = await startGame(participant.sessionId, input.gameKey, config, playlistId);
      if (!result.ok) {
        throw new TRPCError({ code: "CONFLICT", message: result.error.message, cause: result.error });
      }

      const io = getSocketServer();
      if (io) broadcastGameSnapshot(io, participant.sessionId, result.gameId, result.gameKey, result.state, result.events);

      return { ok: true as const, gameId: result.gameId, gameKey: result.gameKey };
    }),
});

export const appRouter = router({
  system: systemRouter,
  session: sessionRouter,
  game: gameRouter,
  content: contentRouter,
  user: userRouter,
  admin: adminRouter,
});

export type AppRouter = typeof appRouter;
