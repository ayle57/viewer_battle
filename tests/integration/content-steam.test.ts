import { afterAll, describe, expect, it } from "vitest";
import { appRouter } from "@/server/trpc/router";
import { createContentHost } from "@/server/db/contentHost";
import { createSession } from "@/server/db/session";
import { joinSession } from "@/server/db/participant";
import { getCurrentGame } from "@/server/game";
import { prisma } from "@/server/db/client";
import { DEV_PLAYGROUND_HOST_PASSWORD } from "@/domain/session";

/**
 * "Guess the Game" (Steam Ratings)'s Content Studio — the Steam Ratings
 * counterpart to content-music.test.ts/content-geo.test.ts/
 * content-drawing.test.ts, same shape (direct DB/tRPC calls via
 * `appRouter.createCaller({})`, no HTTP/socket server needed), covering
 * contentSteamRouter.ts + contentSteam.ts + the steamRatings branch of
 * `game.start` in router.ts. No other game's own content test file is
 * touched.
 */
describe("Content Studio — Steam Ratings", () => {
  const createdSessionIds = new Set<string>();
  const caller = appRouter.createCaller({});
  // Scoped to rows created from THIS moment on — never a blanket wipe.
  // See content-geo.test.ts's identical comment for the full story: this
  // app has exactly ONE real ContentHost, and a global
  // `contentHost.deleteMany({})` here would destroy that same real row.
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
    const playlist = await caller.content.steamPlaylist.create({ token, gameKey: "steamRatings", name: "Friday Night Games" });
    const g1 = await caller.content.steamGame.create({ token, playlistId: playlist.id, title: "Hollow Knight" });
    await caller.content.steamGame.update({
      token,
      gameId: g1.id,
      imageUrl: "/images/steam/sample-cover.png",
      ratings: ["\"An experience.\"", "\"10/10, would get lost in Deepnest again.\""],
    });
    const g2 = await caller.content.steamGame.create({ token, playlistId: playlist.id, title: "Stardew Valley" });
    await caller.content.steamGame.update({ token, gameId: g2.id, imageUrl: "/images/steam/sample-cover.png", ratings: ["\"My marriage ended but my farm thrived.\""] });
    return playlist;
  }

  describe("playlist CRUD", () => {
    it("creates, lists, and reads back an empty playlist as not-ready", async () => {
      const token = await freshHost();
      const playlist = await caller.content.steamPlaylist.create({ token, gameKey: "steamRatings", name: "Test Playlist" });
      expect(playlist.readiness.status).toBe("empty");

      const list = await caller.content.steamPlaylist.list({ token, gameKey: "steamRatings" });
      expect(list.some((p) => p.id === playlist.id)).toBe(true);

      const detail = await caller.content.steamPlaylist.get({ token, playlistId: playlist.id });
      expect(detail.steamGames).toEqual([]);
      expect(detail.inUse).toBe(false);
    });

    it("rejects an empty name", async () => {
      const token = await freshHost();
      await expect(caller.content.steamPlaylist.create({ token, gameKey: "steamRatings", name: "   " })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    });

    it("renames and deletes a playlist", async () => {
      const token = await freshHost();
      const playlist = await caller.content.steamPlaylist.create({ token, gameKey: "steamRatings", name: "Original" });
      const renamed = await caller.content.steamPlaylist.update({ token, playlistId: playlist.id, name: "Renamed" });
      expect(renamed.name).toBe("Renamed");

      await caller.content.steamPlaylist.delete({ token, playlistId: playlist.id });
      await expect(caller.content.steamPlaylist.get({ token, playlistId: playlist.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("duplicates a playlist, including its games (title + cover + full ratings array), as a genuinely independent copy", async () => {
      const token = await freshHost();
      const playlist = await freshReadyPlaylist(token);
      const copy = await caller.content.steamPlaylist.duplicate({ token, playlistId: playlist.id });
      expect(copy.id).not.toBe(playlist.id);
      expect(copy.name).toBe(`${playlist.name} (Copy)`);

      const copyDetail = await caller.content.steamPlaylist.get({ token, playlistId: copy.id });
      expect(copyDetail.steamGames.map((g) => [g.title, g.imageUrl, g.ratings])).toEqual([
        ["Hollow Knight", "/images/steam/sample-cover.png", ["\"An experience.\"", "\"10/10, would get lost in Deepnest again.\""]],
        ["Stardew Valley", "/images/steam/sample-cover.png", ["\"My marriage ended but my farm thrived.\""]],
      ]);

      // Genuinely independent — editing the copy doesn't touch the original.
      await caller.content.steamGame.update({ token, gameId: copyDetail.steamGames[0]!.id, title: "Edited" });
      const originalDetail = await caller.content.steamPlaylist.get({ token, playlistId: playlist.id });
      expect(originalDetail.steamGames[0]!.title).toBe("Hollow Knight");
    });
  });

  describe("game CRUD and readiness", () => {
    it("a fresh game is an empty shell — not-ready until title, cover, AND at least one rating are all set", async () => {
      const token = await freshHost();
      const playlist = await caller.content.steamPlaylist.create({ token, gameKey: "steamRatings", name: "Test" });
      const game = await caller.content.steamGame.create({ token, playlistId: playlist.id });
      expect(game.title).toBeNull();
      expect(game.imageUrl).toBeNull();
      expect(game.ratings).toEqual([]);

      let detail = await caller.content.steamPlaylist.get({ token, playlistId: playlist.id });
      expect(detail.readiness.status).toBe("incomplete"); // a shell row exists -> incomplete, not empty

      await caller.content.steamGame.update({ token, gameId: game.id, title: "Hollow Knight" });
      detail = await caller.content.steamPlaylist.get({ token, playlistId: playlist.id });
      expect(detail.readiness.status).toBe("incomplete"); // title alone isn't enough

      await caller.content.steamGame.update({ token, gameId: game.id, imageUrl: "/images/steam/sample-cover.png" });
      detail = await caller.content.steamPlaylist.get({ token, playlistId: playlist.id });
      expect(detail.readiness.status).toBe("incomplete"); // still missing at least one rating

      await caller.content.steamGame.update({ token, gameId: game.id, ratings: ["\"An experience.\""] });
      detail = await caller.content.steamPlaylist.get({ token, playlistId: playlist.id });
      expect(detail.readiness.status).toBe("ready");
    });

    it("rejects blank (but non-null) title or imageUrl, a blank rating, and more than 10 ratings", async () => {
      const token = await freshHost();
      const playlist = await caller.content.steamPlaylist.create({ token, gameKey: "steamRatings", name: "Test" });
      const game = await caller.content.steamGame.create({ token, playlistId: playlist.id, title: "X" });
      await expect(caller.content.steamGame.update({ token, gameId: game.id, title: "   " })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(caller.content.steamGame.update({ token, gameId: game.id, imageUrl: "   " })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(caller.content.steamGame.update({ token, gameId: game.id, ratings: ["ok", "   "] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(
        caller.content.steamGame.update({ token, gameId: game.id, ratings: Array.from({ length: 11 }, (_, i) => `rating ${i}`) }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("clearing imageUrl (remove cover) drops a ready game back to incomplete — clearing must persist", async () => {
      const token = await freshHost();
      const playlist = await freshReadyPlaylist(token);
      const before = await caller.content.steamPlaylist.get({ token, playlistId: playlist.id });
      const game = before.steamGames[0]!;

      await caller.content.steamGame.update({ token, gameId: game.id, imageUrl: null });
      const detail = await caller.content.steamPlaylist.get({ token, playlistId: playlist.id });
      const updated = detail.steamGames.find((g) => g.id === game.id)!;
      expect(updated.imageUrl).toBeNull(); // re-read confirms null, not the old value re-appearing
      expect(detail.readiness.status).toBe("incomplete");
    });

    it("replacing ratings overwrites the whole array, title/imageUrl untouched, readiness stays ready", async () => {
      const token = await freshHost();
      const playlist = await freshReadyPlaylist(token);
      const before = await caller.content.steamPlaylist.get({ token, playlistId: playlist.id });
      const game = before.steamGames[0]!;

      await caller.content.steamGame.update({ token, gameId: game.id, ratings: ["new one", "new two", "new three"] });
      const detail = await caller.content.steamPlaylist.get({ token, playlistId: playlist.id });
      const updated = detail.steamGames.find((g) => g.id === game.id)!;
      expect(updated.ratings).toEqual(["new one", "new two", "new three"]);
      expect(updated.title).toBe("Hollow Knight");
      expect(updated.imageUrl).toBe("/images/steam/sample-cover.png");
      expect(detail.readiness.status).toBe("ready");
    });

    it("deletes a game and leaves the remaining one behind", async () => {
      const token = await freshHost();
      const playlist = await freshReadyPlaylist(token);
      const before = await caller.content.steamPlaylist.get({ token, playlistId: playlist.id });
      const [first, second] = before.steamGames;

      await caller.content.steamGame.delete({ token, gameId: first!.id });
      const after = await caller.content.steamPlaylist.get({ token, playlistId: playlist.id });
      expect(after.steamGames.map((g) => g.id)).toEqual([second!.id]);
    });

    it("duplicates a game — title/cover/ratings copied, a new id, the original untouched", async () => {
      const token = await freshHost();
      const playlist = await freshReadyPlaylist(token);
      const before = await caller.content.steamPlaylist.get({ token, playlistId: playlist.id });
      const source = before.steamGames[0]!;

      const copy = await caller.content.steamGame.duplicate({ token, gameId: source.id });
      expect(copy.id).not.toBe(source.id);
      expect(copy.title).toBe(`${source.title} (Copy)`);
      expect(copy.imageUrl).toBe(source.imageUrl);
      expect(copy.ratings).toEqual(source.ratings);

      const after = await caller.content.steamPlaylist.get({ token, playlistId: playlist.id });
      expect(after.steamGames.map((g) => g.id)).toEqual([source.id, before.steamGames[1]!.id, copy.id]);
    });

    it("reorders games, and rejects a reorder list that doesn't match exactly", async () => {
      const token = await freshHost();
      const playlist = await freshReadyPlaylist(token);
      const before = await caller.content.steamPlaylist.get({ token, playlistId: playlist.id });
      const [first, second] = before.steamGames;

      await caller.content.steamGame.reorder({ token, playlistId: playlist.id, orderedGameIds: [second!.id, first!.id] });
      const after = await caller.content.steamPlaylist.get({ token, playlistId: playlist.id });
      expect(after.steamGames.map((g) => g.id)).toEqual([second!.id, first!.id]);

      await expect(
        caller.content.steamGame.reorder({ token, playlistId: playlist.id, orderedGameIds: [first!.id] }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  describe("ownership / IDOR", () => {
    it("Host A cannot read, update, or delete Host B's playlist", async () => {
      const tokenA = await freshHost();
      const tokenB = await freshHost();
      const playlistA = await caller.content.steamPlaylist.create({ token: tokenA, gameKey: "steamRatings", name: "A's playlist" });

      await expect(caller.content.steamPlaylist.get({ token: tokenB, playlistId: playlistA.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        caller.content.steamPlaylist.update({ token: tokenB, playlistId: playlistA.id, name: "Hijacked" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(caller.content.steamPlaylist.delete({ token: tokenB, playlistId: playlistA.id })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });

      const stillA = await caller.content.steamPlaylist.get({ token: tokenA, playlistId: playlistA.id });
      expect(stillA.name).toBe("A's playlist");
    });

    it("Host A cannot create, update, or delete a game on Host B's playlist", async () => {
      const tokenA = await freshHost();
      const tokenB = await freshHost();
      const playlistA = await freshReadyPlaylist(tokenA);
      const detail = await caller.content.steamPlaylist.get({ token: tokenA, playlistId: playlistA.id });
      const gameA = detail.steamGames[0]!;

      await expect(caller.content.steamGame.create({ token: tokenB, playlistId: playlistA.id })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(caller.content.steamGame.update({ token: tokenB, gameId: gameA.id, title: "Hijacked" })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(caller.content.steamGame.delete({ token: tokenB, gameId: gameA.id })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  describe("playlist selection at game start", () => {
    async function hostedSession() {
      const session = await createSession();
      createdSessionIds.add(session.id);
      const host = await joinSession({ sessionCode: session.code, role: "HOST", displayName: "Alex" });
      return { session, hostToken: host.token };
    }

    it("starts a Steam Ratings game using the Host's prepared playlist, not the sample games", async () => {
      const contentToken = await freshHost();
      const playlist = await freshReadyPlaylist(contentToken);
      const { session, hostToken } = await hostedSession();

      const started = await caller.game.start({
        token: hostToken,
        gameKey: "steamRatings",
        content: { type: "playlist", playlistId: playlist.id, contentToken },
      });
      expect(started.ok).toBe(true);
      expect(started.gameKey).toBe("steamRatings");

      const game = await getCurrentGame(session.id);
      expect(game?.playlistId).toBe(playlist.id);
      const state = game?.internalState as { rounds: { title: string; ratings: string[] }[] };
      expect(state.rounds.map((r) => r.title)).toEqual(["Hollow Knight", "Stardew Valley"]);
      expect(state.rounds[0]!.ratings).toEqual(["\"An experience.\"", "\"10/10, would get lost in Deepnest again.\""]);
    });

    it("falls back to the built-in sample games when no content is chosen", async () => {
      const { session, hostToken } = await hostedSession();
      const started = await caller.game.start({ token: hostToken, gameKey: "steamRatings" });
      expect(started.ok).toBe(true);
      const game = await getCurrentGame(session.id);
      expect(game?.playlistId).toBeNull();
      const state = game?.internalState as { rounds: unknown[] };
      expect(state.rounds.length).toBeGreaterThan(0);
    });

    it("rejects starting a Steam Ratings game with another host's playlist (IDOR-safe)", async () => {
      const contentTokenA = await freshHost();
      const playlistA = await freshReadyPlaylist(contentTokenA);
      const contentTokenB = await freshHost();
      const { hostToken } = await hostedSession();

      await expect(
        caller.game.start({
          token: hostToken,
          gameKey: "steamRatings",
          content: { type: "playlist", playlistId: playlistA.id, contentToken: contentTokenB },
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("a playlist deleted AFTER the Host selected it fails Start Game cleanly — no crash, no SessionGame row", async () => {
      const contentToken = await freshHost();
      const playlist = await freshReadyPlaylist(contentToken);
      const { session, hostToken } = await hostedSession();

      await caller.content.steamPlaylist.delete({ token: contentToken, playlistId: playlist.id });

      await expect(
        caller.game.start({
          token: hostToken,
          gameKey: "steamRatings",
          content: { type: "playlist", playlistId: playlist.id, contentToken },
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });

      expect(await getCurrentGame(session.id)).toBeNull();
    });

    it("refuses to start with an incomplete Steam Ratings playlist, and never creates a SessionGame row for it", async () => {
      const contentToken = await freshHost();
      const playlist = await caller.content.steamPlaylist.create({ token: contentToken, gameKey: "steamRatings", name: "Incomplete" });
      await caller.content.steamGame.create({ token: contentToken, playlistId: playlist.id }); // no title/cover/ratings — never completed
      const { session, hostToken } = await hostedSession();

      await expect(
        caller.game.start({
          token: hostToken,
          gameKey: "steamRatings",
          content: { type: "playlist", playlistId: playlist.id, contentToken },
        }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

      expect(await getCurrentGame(session.id)).toBeNull();
    });

    it("plays games in exactly the persisted reorder, not creation order", async () => {
      const contentToken = await freshHost();
      const playlist = await freshReadyPlaylist(contentToken); // created as [Hollow Knight, Stardew Valley]
      const before = await caller.content.steamPlaylist.get({ token: contentToken, playlistId: playlist.id });
      const [first, second] = before.steamGames;

      await caller.content.steamGame.reorder({ token: contentToken, playlistId: playlist.id, orderedGameIds: [second!.id, first!.id] });

      const { session, hostToken } = await hostedSession();
      await caller.game.start({ token: hostToken, gameKey: "steamRatings", content: { type: "playlist", playlistId: playlist.id, contentToken } });

      const game = await getCurrentGame(session.id);
      const state = game?.internalState as { rounds: { title: string }[] };
      expect(state.rounds.map((r) => r.title)).toEqual(["Stardew Valley", "Hollow Knight"]);
    });

    it("editing a Steam Ratings playlist after a game has started never changes the running game's snapshot", async () => {
      const contentToken = await freshHost();
      const playlist = await freshReadyPlaylist(contentToken);
      const { session, hostToken } = await hostedSession();
      await caller.game.start({ token: hostToken, gameKey: "steamRatings", content: { type: "playlist", playlistId: playlist.id, contentToken } });

      const detail = await caller.content.steamPlaylist.get({ token: contentToken, playlistId: playlist.id });
      await caller.content.steamGame.update({ token: contentToken, gameId: detail.steamGames[0]!.id, title: "Edited mid-game" });

      const game = await getCurrentGame(session.id);
      const state = game?.internalState as { rounds: { title: string }[] };
      expect(state.rounds[0]!.title).toBe("Hollow Knight"); // untouched snapshot, not the live edit
    });
  });

  describe("asset pool", () => {
    it("lists whatever image files exist under public/images/steam, including the bundled sample cover", async () => {
      const assets = await caller.content.steamAsset.list();
      expect(assets.some((a) => a.url === "/images/steam/sample-cover.png")).toBe(true);
    });

    it("deleting a cover is gated behind a real ContentHost token", async () => {
      await expect(caller.content.steamAsset.delete({ token: "not-a-real-token", url: "/images/steam/does-not-exist.png" })).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    });
  });
});
