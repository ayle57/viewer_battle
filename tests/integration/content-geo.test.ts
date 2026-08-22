import { afterAll, describe, expect, it } from "vitest";
import { appRouter } from "@/server/trpc/router";
import { createContentHost } from "@/server/db/contentHost";
import { createSession } from "@/server/db/session";
import { joinSession } from "@/server/db/participant";
import { applyGameAction, getCurrentGame } from "@/server/game";
import { prisma } from "@/server/db/client";
import { DEV_PLAYGROUND_HOST_PASSWORD } from "@/domain/session";

/**
 * GeoGuessr's Content Studio — the geo counterpart to content.test.ts,
 * same shape (direct DB/tRPC calls via `appRouter.createCaller({})`, no
 * HTTP/socket server needed), covering contentGeoRouter.ts +
 * contentGeo.ts + the geoguessr branch of `game.start` in router.ts.
 * Jeopardy's own content.test.ts is untouched — this is a new, parallel
 * file, not an edit to it.
 */
describe("Content Studio — GeoGuessr", () => {
  const createdSessionIds = new Set<string>();
  const caller = appRouter.createCaller({});
  // Scoped to rows created from THIS moment on — never a blanket
  // `contentHost.deleteMany({})`. This app has exactly ONE real
  // ContentHost (the streamer); a global wipe here destroys that same
  // real row (and cascades onto every real Playlist/PlaylistRound under
  // it) the next time this suite runs — see content.test.ts's identical
  // comment for the full story (this was a real reported bug, not
  // hypothetical). A timestamp cutoff, not per-call `hostId` tracking —
  // exhaustive by construction, can't miss a call site added later.
  const suiteStartedAt = new Date();

  afterAll(async () => {
    await prisma.session.deleteMany({ where: { id: { in: Array.from(createdSessionIds) } } });
    await prisma.contentHost.deleteMany({ where: { createdAt: { gte: suiteStartedAt } } });
    await prisma.$disconnect();
  });

  async function freshHost() {
    const { token } = await createContentHost(DEV_PLAYGROUND_HOST_PASSWORD);
    return token;
  }

  async function freshReadyPlaylist(token: string) {
    const playlist = await caller.content.geoPlaylist.create({ token, gameKey: "geoguessr", name: "Arc Raiders — Season 1" });
    const r1 = await caller.content.geoRound.create({ token, playlistId: playlist.id, title: "Dam Battlegrounds" });
    await caller.content.geoRound.update({
      token,
      roundId: r1.id,
      imageUrl: "/images/maps/ac_odyssey_world_map.jpg",
      question: "Where is the dam?",
      targetX: 0.4,
      targetY: 0.6,
    });
    const r2 = await caller.content.geoRound.create({ token, playlistId: playlist.id, title: "Blue Lake" });
    await caller.content.geoRound.update({
      token,
      roundId: r2.id,
      imageUrl: "/images/maps/ac_odyssey_world_map.jpg",
      question: "Where is the lake?",
      targetX: 0.2,
      targetY: 0.8,
    });
    return playlist;
  }

  describe("playlist CRUD", () => {
    it("creates, lists, and reads back an empty playlist as not-ready", async () => {
      const token = await freshHost();
      const playlist = await caller.content.geoPlaylist.create({ token, gameKey: "geoguessr", name: "Test Maps" });
      expect(playlist.readiness.status).toBe("empty");

      const list = await caller.content.geoPlaylist.list({ token, gameKey: "geoguessr" });
      expect(list.some((p) => p.id === playlist.id)).toBe(true);

      const detail = await caller.content.geoPlaylist.get({ token, playlistId: playlist.id });
      expect(detail.rounds).toEqual([]);
      expect(detail.inUse).toBe(false);
    });

    it("rejects an empty name", async () => {
      const token = await freshHost();
      await expect(caller.content.geoPlaylist.create({ token, gameKey: "geoguessr", name: "   " })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    });

    it("renames and deletes a playlist", async () => {
      const token = await freshHost();
      const playlist = await caller.content.geoPlaylist.create({ token, gameKey: "geoguessr", name: "Original" });
      const renamed = await caller.content.geoPlaylist.update({ token, playlistId: playlist.id, name: "Renamed" });
      expect(renamed.name).toBe("Renamed");

      await caller.content.geoPlaylist.delete({ token, playlistId: playlist.id });
      await expect(caller.content.geoPlaylist.get({ token, playlistId: playlist.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("duplicates a playlist, including its rounds, as a genuinely independent copy", async () => {
      const token = await freshHost();
      const original = await freshReadyPlaylist(token);
      const copy = await caller.content.geoPlaylist.duplicate({ token, playlistId: original.id });
      expect(copy.id).not.toBe(original.id);
      expect(copy.name).toBe("Arc Raiders — Season 1 (Copy)");

      const copyDetail = await caller.content.geoPlaylist.get({ token, playlistId: copy.id });
      expect(copyDetail.rounds).toHaveLength(2);
      expect(copyDetail.readiness.ready).toBe(true);

      // Editing the copy never touches the original.
      await caller.content.geoRound.update({ token, roundId: copyDetail.rounds[0]!.id, imageUrl: null });
      const originalDetail = await caller.content.geoPlaylist.get({ token, playlistId: original.id });
      expect(originalDetail.readiness.ready).toBe(true);
    });
  });

  describe("round CRUD and readiness", () => {
    it("a fresh round is an empty shell — not-ready until image, question, AND target are all set", async () => {
      const token = await freshHost();
      const playlist = await caller.content.geoPlaylist.create({ token, gameKey: "geoguessr", name: "Readiness Test" });
      const round = await caller.content.geoRound.create({ token, playlistId: playlist.id });

      let detail = await caller.content.geoPlaylist.get({ token, playlistId: playlist.id });
      expect(detail.readiness.status).toBe("incomplete");
      expect(detail.readiness.incompleteRounds).toEqual([
        { roundId: round.id, missingImage: true, missingQuestion: true, missingTarget: true },
      ]);

      await caller.content.geoRound.update({ token, roundId: round.id, imageUrl: "/images/maps/ac_odyssey_world_map.jpg" });
      detail = await caller.content.geoPlaylist.get({ token, playlistId: playlist.id });
      expect(detail.readiness.incompleteRounds).toEqual([
        { roundId: round.id, missingImage: false, missingQuestion: true, missingTarget: true },
      ]);

      await caller.content.geoRound.update({ token, roundId: round.id, question: "Where is the summit?" });
      detail = await caller.content.geoPlaylist.get({ token, playlistId: playlist.id });
      expect(detail.readiness.incompleteRounds).toEqual([
        { roundId: round.id, missingImage: false, missingQuestion: false, missingTarget: true },
      ]);

      await caller.content.geoRound.update({ token, roundId: round.id, targetX: 0.5, targetY: 0.5 });
      detail = await caller.content.geoPlaylist.get({ token, playlistId: playlist.id });
      expect(detail.readiness.status).toBe("ready");
    });

    it("Remove map (imageUrl: null) drops a ready round back to incomplete — clearing must persist, not just look cleared client-side", async () => {
      const token = await freshHost();
      const playlist = await freshReadyPlaylist(token);
      const round = (await caller.content.geoPlaylist.get({ token, playlistId: playlist.id })).rounds[0]!;
      expect((await caller.content.geoPlaylist.get({ token, playlistId: playlist.id })).readiness.status).toBe("ready");

      await caller.content.geoRound.update({ token, roundId: round.id, imageUrl: null });
      const afterRemove = await caller.content.geoPlaylist.get({ token, playlistId: playlist.id });
      expect(afterRemove.readiness.status).toBe("incomplete");
      expect(afterRemove.readiness.incompleteRounds).toContainEqual({ roundId: round.id, missingImage: true, missingQuestion: false, missingTarget: false });
      // The clear itself actually persisted — re-reading the round shows null, not the old value re-appearing.
      const reread = await caller.content.geoPlaylist.get({ token, playlistId: playlist.id });
      expect(reread.rounds.find((r) => r.id === round.id)?.imageUrl).toBeNull();
    });

    it("Reset location (targetX/targetY: null) drops a ready round back to incomplete, and requires both coordinates cleared together", async () => {
      const token = await freshHost();
      const playlist = await freshReadyPlaylist(token);
      const round = (await caller.content.geoPlaylist.get({ token, playlistId: playlist.id })).rounds[0]!;

      // Clearing only one side of an already-SET target is rejected the
      // same way setting only one side is (contentGeo.ts's own "both or
      // neither" guarantee, checked against the EFFECTIVE value).
      await expect(caller.content.geoRound.update({ token, roundId: round.id, targetX: null })).rejects.toMatchObject({ code: "BAD_REQUEST" });

      await caller.content.geoRound.update({ token, roundId: round.id, targetX: null, targetY: null });
      const afterReset = await caller.content.geoPlaylist.get({ token, playlistId: playlist.id });
      expect(afterReset.readiness.status).toBe("incomplete");
      expect(afterReset.readiness.incompleteRounds).toContainEqual({ roundId: round.id, missingImage: false, missingQuestion: false, missingTarget: true });
      const reread = await caller.content.geoPlaylist.get({ token, playlistId: playlist.id });
      const rereadRound = reread.rounds.find((r) => r.id === round.id)!;
      expect(rereadRound.targetX).toBeNull();
      expect(rereadRound.targetY).toBeNull();
    });

    it("Replace map: a new imageUrl overwrites the old one, doesn't disturb question/target, and the OLD url is genuinely gone from the round", async () => {
      const token = await freshHost();
      const playlist = await freshReadyPlaylist(token);
      const round = (await caller.content.geoPlaylist.get({ token, playlistId: playlist.id })).rounds[0]!;
      const originalUrl = round.imageUrl;

      await caller.content.geoRound.update({ token, roundId: round.id, imageUrl: "/images/maps/a-different-map.jpg" });
      const detail = await caller.content.geoPlaylist.get({ token, playlistId: playlist.id });
      const updated = detail.rounds.find((r) => r.id === round.id)!;
      expect(updated.imageUrl).toBe("/images/maps/a-different-map.jpg");
      expect(updated.imageUrl).not.toBe(originalUrl);
      expect(updated.targetX).toBe(round.targetX); // untouched
      expect(updated.question).toBe(round.question); // untouched
      expect(detail.readiness.status).toBe("ready"); // still ready — a replace, not a clear
    });

    it("rejects a target with only one coordinate set (must be set together)", async () => {
      const token = await freshHost();
      const playlist = await caller.content.geoPlaylist.create({ token, gameKey: "geoguessr", name: "Half Target" });
      const round = await caller.content.geoRound.create({ token, playlistId: playlist.id });
      await expect(caller.content.geoRound.update({ token, roundId: round.id, targetX: 0.5 })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    });

    it("rejects out-of-range target coordinates", async () => {
      const token = await freshHost();
      const playlist = await caller.content.geoPlaylist.create({ token, gameKey: "geoguessr", name: "Bad Target" });
      const round = await caller.content.geoRound.create({ token, playlistId: playlist.id });
      // The input schema itself (contentGeoRouter.ts) rejects out-of-range
      // numbers before they ever reach validateRoundInput.
      await expect(
        caller.content.geoRound.update({ token, roundId: round.id, targetX: 1.5, targetY: 0.5 }),
      ).rejects.toBeDefined();
    });

    it("deletes a round and reorders the remaining ones", async () => {
      const token = await freshHost();
      const playlist = await freshReadyPlaylist(token);
      const before = await caller.content.geoPlaylist.get({ token, playlistId: playlist.id });
      const [first, second] = before.rounds;

      await caller.content.geoRound.reorder({ token, playlistId: playlist.id, orderedRoundIds: [second!.id, first!.id] });
      const reordered = await caller.content.geoPlaylist.get({ token, playlistId: playlist.id });
      expect(reordered.rounds.map((r) => r.id)).toEqual([second!.id, first!.id]);

      await caller.content.geoRound.delete({ token, roundId: first!.id });
      const afterDelete = await caller.content.geoPlaylist.get({ token, playlistId: playlist.id });
      expect(afterDelete.rounds).toHaveLength(1);
      expect(afterDelete.rounds[0]!.id).toBe(second!.id);
    });

    it("duplicates a round — question, image reference, and target all copied, a new id, the original untouched", async () => {
      const token = await freshHost();
      const playlist = await freshReadyPlaylist(token);
      const before = await caller.content.geoPlaylist.get({ token, playlistId: playlist.id });
      const original = before.rounds[0]!;

      const copy = await caller.content.geoRound.duplicate({ token, roundId: original.id });
      expect(copy.id).not.toBe(original.id);
      expect(copy.title).toBe("Dam Battlegrounds (Copy)");
      expect(copy.imageUrl).toBe(original.imageUrl);
      expect(copy.question).toBe(original.question);
      expect(copy.targetX).toBe(original.targetX);
      expect(copy.targetY).toBe(original.targetY);

      const after = await caller.content.geoPlaylist.get({ token, playlistId: playlist.id });
      expect(after.rounds).toHaveLength(3); // appended, not inserted after the source
      expect(after.rounds.map((r) => r.id)).toContain(copy.id);
      expect(after.readiness.ready).toBe(true); // the copy is already complete, same as its source

      // Editing the copy never touches the original.
      await caller.content.geoRound.update({ token, roundId: copy.id, question: "Edited copy only" });
      const afterEdit = await caller.content.geoPlaylist.get({ token, playlistId: playlist.id });
      expect(afterEdit.rounds.find((r) => r.id === original.id)?.question).toBe(original.question);
    });
  });

  describe("ownership / IDOR", () => {
    it("Host A cannot read, update, or delete Host B's playlist", async () => {
      const tokenA = await freshHost();
      const tokenB = await freshHost();
      const playlistA = await caller.content.geoPlaylist.create({ token: tokenA, gameKey: "geoguessr", name: "A's maps" });

      await expect(caller.content.geoPlaylist.get({ token: tokenB, playlistId: playlistA.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(caller.content.geoPlaylist.update({ token: tokenB, playlistId: playlistA.id, name: "Hijacked" })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(caller.content.geoPlaylist.delete({ token: tokenB, playlistId: playlistA.id })).rejects.toMatchObject({ code: "NOT_FOUND" });

      const stillA = await caller.content.geoPlaylist.get({ token: tokenA, playlistId: playlistA.id });
      expect(stillA.name).toBe("A's maps");
    });

    it("Host A cannot create, update, or delete a round on Host B's playlist", async () => {
      const tokenA = await freshHost();
      const tokenB = await freshHost();
      const playlistA = await freshReadyPlaylist(tokenA);
      const detail = await caller.content.geoPlaylist.get({ token: tokenA, playlistId: playlistA.id });
      const roundA = detail.rounds[0]!;

      await expect(caller.content.geoRound.create({ token: tokenB, playlistId: playlistA.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(caller.content.geoRound.update({ token: tokenB, roundId: roundA.id, title: "Hijacked" })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(caller.content.geoRound.delete({ token: tokenB, roundId: roundA.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("playlist selection at game start", () => {
    async function hostedSession() {
      const session = await createSession();
      createdSessionIds.add(session.id);
      const host = await joinSession({ sessionCode: session.code, role: "HOST", displayName: "Alex" });
      return { session, hostToken: host.token };
    }

    it("starts a GeoGuessr game using the Host's prepared playlist, not the sample rounds", async () => {
      const contentToken = await freshHost();
      const playlist = await freshReadyPlaylist(contentToken);
      const { session, hostToken } = await hostedSession();

      const started = await caller.game.start({
        token: hostToken,
        gameKey: "geoguessr",
        content: { type: "playlist", playlistId: playlist.id, contentToken },
      });
      expect(started.ok).toBe(true);
      expect(started.gameKey).toBe("geoguessr");

      const game = await getCurrentGame(session.id);
      expect(game?.playlistId).toBe(playlist.id);
      const state = game?.internalState as { rounds: { title?: string }[] };
      expect(state.rounds.map((r) => r.title)).toEqual(["Dam Battlegrounds", "Blue Lake"]);
    });

    it("falls back to the built-in sample rounds when no content is chosen", async () => {
      const { session, hostToken } = await hostedSession();
      const started = await caller.game.start({ token: hostToken, gameKey: "geoguessr" });
      expect(started.ok).toBe(true);
      const game = await getCurrentGame(session.id);
      expect(game?.playlistId).toBeNull();
      const state = game?.internalState as { rounds: unknown[] };
      expect(state.rounds.length).toBeGreaterThan(0);
    });

    it("rejects starting a GeoGuessr game with another host's playlist (IDOR-safe)", async () => {
      const contentTokenA = await freshHost();
      const playlistA = await freshReadyPlaylist(contentTokenA);
      const contentTokenB = await freshHost();
      const { hostToken } = await hostedSession();

      await expect(
        caller.game.start({
          token: hostToken,
          gameKey: "geoguessr",
          content: { type: "playlist", playlistId: playlistA.id, contentToken: contentTokenB },
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("a playlist deleted AFTER the Host selected it (another Content Studio tab, mid-session) fails Start Game cleanly — no crash, no SessionGame row, a real error code", async () => {
      const contentToken = await freshHost();
      const playlist = await freshReadyPlaylist(contentToken); // ready at the moment the Host's picker would have shown it
      const { session, hostToken } = await hostedSession();

      // Deleted from a DIFFERENT Content Studio tab/session — the exact
      // "content deleted while /host is open" scenario: the Host's own
      // picker still has this playlistId selected in local state, but it
      // no longer exists server-side by the time they actually click
      // Start Game.
      await caller.content.geoPlaylist.delete({ token: contentToken, playlistId: playlist.id });

      await expect(
        caller.game.start({
          token: hostToken,
          gameKey: "geoguessr",
          content: { type: "playlist", playlistId: playlist.id, contentToken },
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });

      expect(await getCurrentGame(session.id)).toBeNull(); // no half-created game left behind
    });

    it("refuses to start with an incomplete GeoGuessr playlist, and never creates a SessionGame row for it", async () => {
      const contentToken = await freshHost();
      const playlist = await caller.content.geoPlaylist.create({ token: contentToken, gameKey: "geoguessr", name: "Incomplete" });
      await caller.content.geoRound.create({ token: contentToken, playlistId: playlist.id }); // no image/target — never completed
      const { session, hostToken } = await hostedSession();

      await expect(
        caller.game.start({
          token: hostToken,
          gameKey: "geoguessr",
          content: { type: "playlist", playlistId: playlist.id, contentToken },
        }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

      expect(await getCurrentGame(session.id)).toBeNull();
    });

    /** Locks item 8's explicit ask: the Content Studio round ORDER is what the Game Kernel actually plays, not creation order. */
    it("plays rounds in exactly the persisted reorder, not the order they were created in", async () => {
      const contentToken = await freshHost();
      const playlist = await freshReadyPlaylist(contentToken); // created as [Dam Battlegrounds, Blue Lake]
      const before = await caller.content.geoPlaylist.get({ token: contentToken, playlistId: playlist.id });
      const [first, second] = before.rounds;

      // Flip the order before the game ever starts.
      await caller.content.geoRound.reorder({ token: contentToken, playlistId: playlist.id, orderedRoundIds: [second!.id, first!.id] });

      const { session, hostToken } = await hostedSession();
      await caller.game.start({ token: hostToken, gameKey: "geoguessr", content: { type: "playlist", playlistId: playlist.id, contentToken } });

      const game = await getCurrentGame(session.id);
      const state = game?.internalState as { rounds: { title?: string }[] };
      expect(state.rounds.map((r) => r.title)).toEqual(["Blue Lake", "Dam Battlegrounds"]); // the REORDERED order, not creation order
    });

    it("editing a GeoGuessr playlist after a game has started never changes the running game's snapshot", async () => {
      const contentToken = await freshHost();
      const playlist = await freshReadyPlaylist(contentToken);
      const { session, hostToken } = await hostedSession();

      await caller.game.start({ token: hostToken, gameKey: "geoguessr", content: { type: "playlist", playlistId: playlist.id, contentToken } });
      const beforeEdit = await getCurrentGame(session.id);
      const beforeState = beforeEdit?.internalState as { rounds: { title?: string; question: string }[] };

      // Live-edit the playlist mid-game: retitle a round, add a new one.
      const detail = await caller.content.geoPlaylist.get({ token: contentToken, playlistId: playlist.id });
      await caller.content.geoRound.update({ token: contentToken, roundId: detail.rounds[0]!.id, title: "Renamed Live", question: "Renamed live question?" });
      await caller.content.geoRound.create({ token: contentToken, playlistId: playlist.id, title: "Added Live" });

      // Advance the actual game a bit, to prove it's still the untouched snapshot doing the work.
      const acted = await applyGameAction(session.id, { type: "SET_GUESS", by: "TEAM_A", byName: "P", x: 0.5, y: 0.5 });
      expect(acted.ok).toBe(true);

      const afterEdit = await getCurrentGame(session.id);
      const afterState = afterEdit?.internalState as { rounds: { title?: string; question: string }[] };
      expect(afterState.rounds.map((r) => r.title)).toEqual(beforeState.rounds.map((r) => r.title));
      expect(afterState.rounds.map((r) => r.title)).not.toContain("Renamed Live");
      expect(afterState.rounds.map((r) => r.title)).not.toContain("Added Live");
      expect(afterState.rounds).toHaveLength(beforeState.rounds.length); // the added-live round never joined the running snapshot either

      // But the Playlist itself really did change, for the NEXT game.
      const playlistNow = await caller.content.geoPlaylist.get({ token: contentToken, playlistId: playlist.id });
      expect(playlistNow.rounds.map((r) => r.title)).toContain("Renamed Live");
      expect(playlistNow.rounds.map((r) => r.title)).toContain("Added Live");
    });

    it("Play Again with the same (now-edited) GeoGuessr playlist picks up the new version in the next game", async () => {
      const contentToken = await freshHost();
      const playlist = await freshReadyPlaylist(contentToken);
      const { session, hostToken } = await hostedSession();

      await caller.game.start({ token: hostToken, gameKey: "geoguessr", content: { type: "playlist", playlistId: playlist.id, contentToken } });
      await applyGameAction(session.id, { type: "END_GAME", by: "HOST" }); // finish the first game so a second one can start

      const newRound = await caller.content.geoRound.create({ token: contentToken, playlistId: playlist.id, title: "Added After Game 1" });
      await caller.content.geoRound.update({
        token: contentToken,
        roundId: newRound.id,
        imageUrl: "/images/maps/ac_odyssey_world_map.jpg",
        question: "Where is the new spot?",
        targetX: 0.1,
        targetY: 0.1,
      });

      const again = await caller.game.start({ token: hostToken, gameKey: "geoguessr", content: { type: "playlist", playlistId: playlist.id, contentToken } });
      expect(again.ok).toBe(true);

      const game = await getCurrentGame(session.id);
      const state = game?.internalState as { rounds: { title?: string }[] };
      expect(state.rounds.map((r) => r.title)).toContain("Added After Game 1");
    });
  });
});
