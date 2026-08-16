import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "@/server/trpc/trpc";
import { toTRPCError } from "@/server/trpc/errors";
import { prisma } from "@/server/db/client";
import { createSession, endSession, getSessionState } from "@/server/db/session";
import { joinSession, reclaimHost, resolveParticipantByToken } from "@/server/db/participant";
import { joinSessionInputSchema, reclaimHostInputSchema, sessionCodeSchema, SessionError } from "@/domain/session";
import { verifyHostPassword } from "@/server/auth/hostPassword";
import { sampleBoard } from "@/domain/game/boardQuestion";
import { ContentError, getPlaylistReadiness, playlistToBoardQuestionConfig } from "@/domain/content";
import { startGame } from "@/server/game";
import { broadcastGameSnapshot } from "@/server/sockets/game";
import { broadcastSessionEnded } from "@/server/sockets/session";
import { getSocketServer } from "@/server/sockets/instance";
import { getOwnedPlaylist } from "@/server/db/content";
import { resolveContentHost } from "@/server/db/contentHost";
import { toContentTRPCError } from "@/server/trpc/contentErrors";
import { contentRouter } from "@/server/trpc/contentRouter";

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
   * Gated behind HOST_PASSWORD (src/server/auth/hostPassword.ts) — this
   * app runs one specific streamer's show, so creating a new game at all
   * requires the one shared secret the operator configured, checked
   * before anything is written to the DB. Separate concern from the
   * per-session host recovery key returned below: this proves "I'm
   * allowed to start a show," the recovery key proves "I'm the same host
   * who already started THIS one."
   */
  create: publicProcedure.input(z.object({ hostPassword: z.string().min(1) })).mutation(async ({ input }) => {
    if (!verifyHostPassword(input.hostPassword)) {
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
   * Host-only: ends the session for real — deletes it (see `endSession`
   * in src/server/db/session.ts for why this isn't a soft
   * `status: FINISHED` update anymore). Rejects anyone whose token
   * doesn't resolve to HOST in that session. Broadcasts `session:ended`
   * to every currently-connected client BEFORE deleting, so Player/
   * Display/other Host tabs get a real-time notice instead of their next
   * poll just 404ing.
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

const gameRouter = router({
  start: publicProcedure
    .input(z.object({ token: z.string().min(1), gameKey: z.literal("board-question"), content: gameStartContentSchema }))
    .mutation(async ({ input }) => {
      let participant;
      try {
        participant = await resolveParticipantByToken(input.token);
      } catch (error) {
        throw toTRPCError(error);
      }
      if (participant.role !== "HOST") {
        throw toTRPCError(new SessionError("FORBIDDEN"));
      }

      let config: unknown = sampleBoard;
      let playlistId: string | null = null;
      if (input.content?.type === "playlist") {
        try {
          // Ownership resolved fresh from the ContentHost token on every
          // start — the SAME check Content Studio's own CRUD uses
          // (src/server/db/content.ts's getOwnedPlaylist), so a Host can
          // never start a game off a Playlist that isn't theirs, even by
          // guessing another host's playlistId.
          const { hostId } = await resolveContentHost(input.content.contentToken);
          const playlist = await getOwnedPlaylist(hostId, input.content.playlistId);
          // boardQuestionSchema (src/domain/game/boardQuestion/types.ts)
          // requires every question's prompt/answer to be non-empty and
          // its value a positive integer — a real Game Kernel rule, not
          // something introduced here. Without this check,
          // engine.createInitialState (called inside startGame below)
          // would `.parse()`-throw on the first incomplete question and
          // surface as a raw, unhelpful INTERNAL_SERVER_ERROR instead of
          // a business error the Host can act on. Re-using the exact same
          // getPlaylistReadiness the Library card/Host lobby already show
          // means this can never disagree with what the Host was told
          // before clicking Start (product brief "Show Preparation"
          // section 10) — the backend stays the source of truth, it just
          // reports its refusal properly instead of crashing.
          const readiness = getPlaylistReadiness(playlist.categories);
          if (!readiness.ready) {
            throw new ContentError("PLAYLIST_NOT_READY", readiness.summary);
          }
          const questions = playlist.categories.flatMap((c) => c.questions);
          config = playlistToBoardQuestionConfig(playlist.categories, questions);
          playlistId = playlist.id;
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
});

export type AppRouter = typeof appRouter;
