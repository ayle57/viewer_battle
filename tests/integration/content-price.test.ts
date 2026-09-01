import { afterAll, describe, expect, it } from "vitest";
import { appRouter } from "@/server/trpc/router";
import { createContentHost } from "@/server/db/contentHost";
import { createSession } from "@/server/db/session";
import { joinSession } from "@/server/db/participant";
import { getCurrentGame } from "@/server/game";
import { prisma } from "@/server/db/client";
import { DEV_PLAYGROUND_HOST_PASSWORD } from "@/domain/session";

/**
 * "Guess the Price"'s Content Studio — the Guess-the-Price counterpart
 * to content-steam.test.ts/content-music.test.ts/content-geo.test.ts/
 * content-drawing.test.ts, same shape (direct DB/tRPC calls via
 * `appRouter.createCaller({})`, no HTTP/socket server needed), covering
 * contentPriceRouter.ts + contentPrice.ts + the guessThePrice branch of
 * `game.start` in router.ts. No other game's own content test file is
 * touched.
 */
describe("Content Studio — Guess the Price", () => {
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
    const playlist = await caller.content.pricePlaylist.create({ token, gameKey: "guessThePrice", name: "Friday Night Prices" });
    const i1 = await caller.content.priceItem.create({ token, playlistId: playlist.id, title: "Wireless Headphones" });
    await caller.content.priceItem.update({ token, itemId: i1.id, imageUrl: "/images/price/sample-item.png", price: 49.99, marginPercent: 10 });
    const i2 = await caller.content.priceItem.create({ token, playlistId: playlist.id, title: "Standing Desk" });
    await caller.content.priceItem.update({ token, itemId: i2.id, imageUrl: "/images/price/sample-item.png", price: 349 });
    return playlist;
  }

  describe("playlist CRUD", () => {
    it("creates, lists, and reads back an empty playlist as not-ready", async () => {
      const token = await freshHost();
      const playlist = await caller.content.pricePlaylist.create({ token, gameKey: "guessThePrice", name: "Test Playlist" });
      expect(playlist.readiness.status).toBe("empty");

      const list = await caller.content.pricePlaylist.list({ token, gameKey: "guessThePrice" });
      expect(list.some((p) => p.id === playlist.id)).toBe(true);

      const detail = await caller.content.pricePlaylist.get({ token, playlistId: playlist.id });
      expect(detail.priceItems).toEqual([]);
      expect(detail.inUse).toBe(false);
    });

    it("rejects an empty name", async () => {
      const token = await freshHost();
      await expect(caller.content.pricePlaylist.create({ token, gameKey: "guessThePrice", name: "   " })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    });

    it("renames and deletes a playlist", async () => {
      const token = await freshHost();
      const playlist = await caller.content.pricePlaylist.create({ token, gameKey: "guessThePrice", name: "Original" });
      const renamed = await caller.content.pricePlaylist.update({ token, playlistId: playlist.id, name: "Renamed" });
      expect(renamed.name).toBe("Renamed");

      await caller.content.pricePlaylist.delete({ token, playlistId: playlist.id });
      await expect(caller.content.pricePlaylist.get({ token, playlistId: playlist.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("duplicates a playlist, including its items (title + photo + price + margin), as a genuinely independent copy", async () => {
      const token = await freshHost();
      const playlist = await freshReadyPlaylist(token);
      const copy = await caller.content.pricePlaylist.duplicate({ token, playlistId: playlist.id });
      expect(copy.id).not.toBe(playlist.id);
      expect(copy.name).toBe(`${playlist.name} (Copy)`);

      const copyDetail = await caller.content.pricePlaylist.get({ token, playlistId: copy.id });
      expect(copyDetail.priceItems.map((i) => [i.title, i.imageUrl, i.price, i.marginPercent])).toEqual([
        ["Wireless Headphones", "/images/price/sample-item.png", 49.99, 10],
        ["Standing Desk", "/images/price/sample-item.png", 349, null],
      ]);

      // Genuinely independent — editing the copy doesn't touch the original.
      await caller.content.priceItem.update({ token, itemId: copyDetail.priceItems[0]!.id, title: "Edited" });
      const originalDetail = await caller.content.pricePlaylist.get({ token, playlistId: playlist.id });
      expect(originalDetail.priceItems[0]!.title).toBe("Wireless Headphones");
    });
  });

  describe("item CRUD and readiness", () => {
    it("a fresh item is an empty shell — not-ready until title, photo, AND price are all set", async () => {
      const token = await freshHost();
      const playlist = await caller.content.pricePlaylist.create({ token, gameKey: "guessThePrice", name: "Test" });
      const item = await caller.content.priceItem.create({ token, playlistId: playlist.id });
      expect(item.title).toBeNull();
      expect(item.imageUrl).toBeNull();
      expect(item.price).toBeNull();

      let detail = await caller.content.pricePlaylist.get({ token, playlistId: playlist.id });
      expect(detail.readiness.status).toBe("incomplete"); // a shell row exists -> incomplete, not empty

      await caller.content.priceItem.update({ token, itemId: item.id, title: "Wireless Headphones" });
      detail = await caller.content.pricePlaylist.get({ token, playlistId: playlist.id });
      expect(detail.readiness.status).toBe("incomplete"); // title alone isn't enough

      await caller.content.priceItem.update({ token, itemId: item.id, imageUrl: "/images/price/sample-item.png" });
      detail = await caller.content.pricePlaylist.get({ token, playlistId: playlist.id });
      expect(detail.readiness.status).toBe("incomplete"); // still missing a price

      await caller.content.priceItem.update({ token, itemId: item.id, price: 49.99 });
      detail = await caller.content.pricePlaylist.get({ token, playlistId: playlist.id });
      expect(detail.readiness.status).toBe("ready");
    });

    it("rejects blank (but non-null) title or imageUrl, a non-positive price, and an out-of-range margin", async () => {
      const token = await freshHost();
      const playlist = await caller.content.pricePlaylist.create({ token, gameKey: "guessThePrice", name: "Test" });
      const item = await caller.content.priceItem.create({ token, playlistId: playlist.id, title: "X" });
      await expect(caller.content.priceItem.update({ token, itemId: item.id, title: "   " })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(caller.content.priceItem.update({ token, itemId: item.id, imageUrl: "   " })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(caller.content.priceItem.update({ token, itemId: item.id, price: 0 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(caller.content.priceItem.update({ token, itemId: item.id, price: -5 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(caller.content.priceItem.update({ token, itemId: item.id, marginPercent: 150 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("clearing imageUrl (remove photo) drops a ready item back to incomplete — clearing must persist", async () => {
      const token = await freshHost();
      const playlist = await freshReadyPlaylist(token);
      const before = await caller.content.pricePlaylist.get({ token, playlistId: playlist.id });
      const item = before.priceItems[0]!;

      await caller.content.priceItem.update({ token, itemId: item.id, imageUrl: null });
      const detail = await caller.content.pricePlaylist.get({ token, playlistId: playlist.id });
      const updated = detail.priceItems.find((i) => i.id === item.id)!;
      expect(updated.imageUrl).toBeNull(); // re-read confirms null, not the old value re-appearing
      expect(detail.readiness.status).toBe("incomplete");
    });

    it("updating price overwrites it, title/imageUrl untouched, readiness stays ready", async () => {
      const token = await freshHost();
      const playlist = await freshReadyPlaylist(token);
      const before = await caller.content.pricePlaylist.get({ token, playlistId: playlist.id });
      const item = before.priceItems[0]!;

      await caller.content.priceItem.update({ token, itemId: item.id, price: 59.99 });
      const detail = await caller.content.pricePlaylist.get({ token, playlistId: playlist.id });
      const updated = detail.priceItems.find((i) => i.id === item.id)!;
      expect(updated.price).toBe(59.99);
      expect(updated.title).toBe("Wireless Headphones");
      expect(updated.imageUrl).toBe("/images/price/sample-item.png");
      expect(detail.readiness.status).toBe("ready");
    });

    it("deletes an item and leaves the remaining one behind", async () => {
      const token = await freshHost();
      const playlist = await freshReadyPlaylist(token);
      const before = await caller.content.pricePlaylist.get({ token, playlistId: playlist.id });
      const [first, second] = before.priceItems;

      await caller.content.priceItem.delete({ token, itemId: first!.id });
      const after = await caller.content.pricePlaylist.get({ token, playlistId: playlist.id });
      expect(after.priceItems.map((i) => i.id)).toEqual([second!.id]);
    });

    it("duplicates an item — title/photo/price/margin copied, a new id, the original untouched", async () => {
      const token = await freshHost();
      const playlist = await freshReadyPlaylist(token);
      const before = await caller.content.pricePlaylist.get({ token, playlistId: playlist.id });
      const source = before.priceItems[0]!;

      const copy = await caller.content.priceItem.duplicate({ token, itemId: source.id });
      expect(copy.id).not.toBe(source.id);
      expect(copy.title).toBe(`${source.title} (Copy)`);
      expect(copy.imageUrl).toBe(source.imageUrl);
      expect(copy.price).toBe(source.price);
      expect(copy.marginPercent).toBe(source.marginPercent);

      const after = await caller.content.pricePlaylist.get({ token, playlistId: playlist.id });
      expect(after.priceItems.map((i) => i.id)).toEqual([source.id, before.priceItems[1]!.id, copy.id]);
    });

    it("reorders items, and rejects a reorder list that doesn't match exactly", async () => {
      const token = await freshHost();
      const playlist = await freshReadyPlaylist(token);
      const before = await caller.content.pricePlaylist.get({ token, playlistId: playlist.id });
      const [first, second] = before.priceItems;

      await caller.content.priceItem.reorder({ token, playlistId: playlist.id, orderedItemIds: [second!.id, first!.id] });
      const after = await caller.content.pricePlaylist.get({ token, playlistId: playlist.id });
      expect(after.priceItems.map((i) => i.id)).toEqual([second!.id, first!.id]);

      await expect(
        caller.content.priceItem.reorder({ token, playlistId: playlist.id, orderedItemIds: [first!.id] }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  describe("ownership / IDOR", () => {
    it("Host A cannot read, update, or delete Host B's playlist", async () => {
      const tokenA = await freshHost();
      const tokenB = await freshHost();
      const playlistA = await caller.content.pricePlaylist.create({ token: tokenA, gameKey: "guessThePrice", name: "A's playlist" });

      await expect(caller.content.pricePlaylist.get({ token: tokenB, playlistId: playlistA.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        caller.content.pricePlaylist.update({ token: tokenB, playlistId: playlistA.id, name: "Hijacked" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(caller.content.pricePlaylist.delete({ token: tokenB, playlistId: playlistA.id })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });

      const stillA = await caller.content.pricePlaylist.get({ token: tokenA, playlistId: playlistA.id });
      expect(stillA.name).toBe("A's playlist");
    });

    it("Host A cannot create, update, or delete an item on Host B's playlist", async () => {
      const tokenA = await freshHost();
      const tokenB = await freshHost();
      const playlistA = await freshReadyPlaylist(tokenA);
      const detail = await caller.content.pricePlaylist.get({ token: tokenA, playlistId: playlistA.id });
      const itemA = detail.priceItems[0]!;

      await expect(caller.content.priceItem.create({ token: tokenB, playlistId: playlistA.id })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(caller.content.priceItem.update({ token: tokenB, itemId: itemA.id, title: "Hijacked" })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(caller.content.priceItem.delete({ token: tokenB, itemId: itemA.id })).rejects.toMatchObject({
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

    it("starts a Guess the Price game using the Host's prepared playlist, not the sample items", async () => {
      const contentToken = await freshHost();
      const playlist = await freshReadyPlaylist(contentToken);
      const { session, hostToken } = await hostedSession();

      const started = await caller.game.start({
        token: hostToken,
        gameKey: "guessThePrice",
        content: { type: "playlist", playlistId: playlist.id, contentToken },
      });
      expect(started.ok).toBe(true);
      expect(started.gameKey).toBe("guessThePrice");

      const game = await getCurrentGame(session.id);
      expect(game?.playlistId).toBe(playlist.id);
      const state = game?.internalState as { rounds: { title: string; price: number }[] };
      expect(state.rounds.map((r) => r.title)).toEqual(["Wireless Headphones", "Standing Desk"]);
      expect(state.rounds[0]!.price).toBe(49.99);
    });

    it("falls back to the built-in sample items when no content is chosen", async () => {
      const { session, hostToken } = await hostedSession();
      const started = await caller.game.start({ token: hostToken, gameKey: "guessThePrice" });
      expect(started.ok).toBe(true);
      const game = await getCurrentGame(session.id);
      expect(game?.playlistId).toBeNull();
      const state = game?.internalState as { rounds: unknown[] };
      expect(state.rounds.length).toBeGreaterThan(0);
    });

    it("rejects starting a Guess the Price game with another host's playlist (IDOR-safe)", async () => {
      const contentTokenA = await freshHost();
      const playlistA = await freshReadyPlaylist(contentTokenA);
      const contentTokenB = await freshHost();
      const { hostToken } = await hostedSession();

      await expect(
        caller.game.start({
          token: hostToken,
          gameKey: "guessThePrice",
          content: { type: "playlist", playlistId: playlistA.id, contentToken: contentTokenB },
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("a playlist deleted AFTER the Host selected it fails Start Game cleanly — no crash, no SessionGame row", async () => {
      const contentToken = await freshHost();
      const playlist = await freshReadyPlaylist(contentToken);
      const { session, hostToken } = await hostedSession();

      await caller.content.pricePlaylist.delete({ token: contentToken, playlistId: playlist.id });

      await expect(
        caller.game.start({
          token: hostToken,
          gameKey: "guessThePrice",
          content: { type: "playlist", playlistId: playlist.id, contentToken },
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });

      expect(await getCurrentGame(session.id)).toBeNull();
    });

    it("refuses to start with an incomplete Guess the Price playlist, and never creates a SessionGame row for it", async () => {
      const contentToken = await freshHost();
      const playlist = await caller.content.pricePlaylist.create({ token: contentToken, gameKey: "guessThePrice", name: "Incomplete" });
      await caller.content.priceItem.create({ token: contentToken, playlistId: playlist.id }); // no title/photo/price — never completed
      const { session, hostToken } = await hostedSession();

      await expect(
        caller.game.start({
          token: hostToken,
          gameKey: "guessThePrice",
          content: { type: "playlist", playlistId: playlist.id, contentToken },
        }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

      expect(await getCurrentGame(session.id)).toBeNull();
    });

    it("plays items in exactly the persisted reorder, not creation order", async () => {
      const contentToken = await freshHost();
      const playlist = await freshReadyPlaylist(contentToken); // created as [Wireless Headphones, Standing Desk]
      const before = await caller.content.pricePlaylist.get({ token: contentToken, playlistId: playlist.id });
      const [first, second] = before.priceItems;

      await caller.content.priceItem.reorder({ token: contentToken, playlistId: playlist.id, orderedItemIds: [second!.id, first!.id] });

      const { session, hostToken } = await hostedSession();
      await caller.game.start({ token: hostToken, gameKey: "guessThePrice", content: { type: "playlist", playlistId: playlist.id, contentToken } });

      const game = await getCurrentGame(session.id);
      const state = game?.internalState as { rounds: { title: string }[] };
      expect(state.rounds.map((r) => r.title)).toEqual(["Standing Desk", "Wireless Headphones"]);
    });

    it("editing a Guess the Price playlist after a game has started never changes the running game's snapshot", async () => {
      const contentToken = await freshHost();
      const playlist = await freshReadyPlaylist(contentToken);
      const { session, hostToken } = await hostedSession();
      await caller.game.start({ token: hostToken, gameKey: "guessThePrice", content: { type: "playlist", playlistId: playlist.id, contentToken } });

      const detail = await caller.content.pricePlaylist.get({ token: contentToken, playlistId: playlist.id });
      await caller.content.priceItem.update({ token: contentToken, itemId: detail.priceItems[0]!.id, title: "Edited mid-game" });

      const game = await getCurrentGame(session.id);
      const state = game?.internalState as { rounds: { title: string }[] };
      expect(state.rounds[0]!.title).toBe("Wireless Headphones"); // untouched snapshot, not the live edit
    });
  });

  describe("asset pool", () => {
    it("lists whatever image files exist under public/images/price, including the bundled sample photo", async () => {
      const assets = await caller.content.priceAsset.list();
      expect(assets.some((a) => a.url === "/images/price/sample-item.png")).toBe(true);
    });

    it("deleting a photo is gated behind a real ContentHost token", async () => {
      await expect(caller.content.priceAsset.delete({ token: "not-a-real-token", url: "/images/price/does-not-exist.png" })).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    });
  });
});
