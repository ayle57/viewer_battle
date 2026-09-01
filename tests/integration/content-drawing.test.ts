import { afterAll, describe, expect, it } from "vitest";
import { appRouter } from "@/server/trpc/router";
import { createContentHost } from "@/server/db/contentHost";
import { createSession } from "@/server/db/session";
import { joinSession } from "@/server/db/participant";
import { getCurrentGame } from "@/server/game";
import { prisma } from "@/server/db/client";
import { DEV_PLAYGROUND_HOST_PASSWORD } from "@/domain/session";

/**
 * Drawing's Content Studio — the Drawing counterpart to
 * content-geo.test.ts, same shape (direct DB/tRPC calls via
 * `appRouter.createCaller({})`, no HTTP/socket server needed), covering
 * contentDrawingRouter.ts + contentDrawing.ts + the drawing branch of
 * `game.start` in router.ts. Jeopardy's/GeoGuessr's own content test
 * files are untouched — this is a new, parallel file, not an edit to
 * either.
 */
describe("Content Studio — Drawing", () => {
  const createdSessionIds = new Set<string>();
  const caller = appRouter.createCaller({});
  // Scoped to rows created from THIS moment on — never a blanket wipe.
  // See content-geo.test.ts's identical comment for the full story (a
  // real reported bug, not hypothetical): this app has exactly ONE real
  // ContentHost, and a global `contentHost.deleteMany({})` here would
  // destroy that same real row.
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
    const playlist = await caller.content.drawingPlaylist.create({ token, gameKey: "drawing", name: "Movie Night Sketches" });
    const p1 = await caller.content.drawingPrompt.create({ token, playlistId: playlist.id, text: "Chenille" });
    await caller.content.drawingPrompt.update({ token, promptId: p1.id, durationSeconds: 45 });
    await caller.content.drawingPrompt.create({ token, playlistId: playlist.id, text: "Dragon" });
    return playlist;
  }

  describe("playlist CRUD", () => {
    it("creates, lists, and reads back an empty playlist as not-ready", async () => {
      const token = await freshHost();
      const playlist = await caller.content.drawingPlaylist.create({ token, gameKey: "drawing", name: "Test Prompts" });
      expect(playlist.readiness.status).toBe("empty");

      const list = await caller.content.drawingPlaylist.list({ token, gameKey: "drawing" });
      expect(list.some((p) => p.id === playlist.id)).toBe(true);

      const detail = await caller.content.drawingPlaylist.get({ token, playlistId: playlist.id });
      expect(detail.prompts).toEqual([]);
      expect(detail.inUse).toBe(false);
    });

    it("rejects an empty name", async () => {
      const token = await freshHost();
      await expect(caller.content.drawingPlaylist.create({ token, gameKey: "drawing", name: "   " })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    });

    it("renames and deletes a playlist", async () => {
      const token = await freshHost();
      const playlist = await caller.content.drawingPlaylist.create({ token, gameKey: "drawing", name: "Original" });
      const renamed = await caller.content.drawingPlaylist.update({ token, playlistId: playlist.id, name: "Renamed" });
      expect(renamed.name).toBe("Renamed");

      await caller.content.drawingPlaylist.delete({ token, playlistId: playlist.id });
      await expect(caller.content.drawingPlaylist.get({ token, playlistId: playlist.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("duplicates a playlist, including its prompts (text + duration), as a genuinely independent copy", async () => {
      const token = await freshHost();
      const playlist = await freshReadyPlaylist(token);
      const copy = await caller.content.drawingPlaylist.duplicate({ token, playlistId: playlist.id });
      expect(copy.id).not.toBe(playlist.id);
      expect(copy.name).toBe(`${playlist.name} (Copy)`);

      const copyDetail = await caller.content.drawingPlaylist.get({ token, playlistId: copy.id });
      expect(copyDetail.prompts.map((p) => [p.text, p.durationSeconds])).toEqual([
        ["Chenille", 45],
        ["Dragon", 30],
      ]);

      // Genuinely independent — editing the copy doesn't touch the original.
      await caller.content.drawingPrompt.update({ token, promptId: copyDetail.prompts[0]!.id, text: "Edited" });
      const originalDetail = await caller.content.drawingPlaylist.get({ token, playlistId: playlist.id });
      expect(originalDetail.prompts[0]!.text).toBe("Chenille");
    });
  });

  describe("prompt CRUD and readiness", () => {
    it("a fresh prompt is an empty shell — not-ready until text is set", async () => {
      const token = await freshHost();
      const playlist = await caller.content.drawingPlaylist.create({ token, gameKey: "drawing", name: "Test" });
      const prompt = await caller.content.drawingPrompt.create({ token, playlistId: playlist.id });
      expect(prompt.text).toBeNull();
      expect(prompt.durationSeconds).toBe(30); // DB default

      let detail = await caller.content.drawingPlaylist.get({ token, playlistId: playlist.id });
      expect(detail.readiness.status).toBe("incomplete");

      await caller.content.drawingPrompt.update({ token, promptId: prompt.id, text: "Chenille" });
      detail = await caller.content.drawingPlaylist.get({ token, playlistId: playlist.id });
      expect(detail.readiness.status).toBe("ready");
    });

    it("rejects blank (but non-null) text", async () => {
      const token = await freshHost();
      const playlist = await caller.content.drawingPlaylist.create({ token, gameKey: "drawing", name: "Test" });
      const prompt = await caller.content.drawingPrompt.create({ token, playlistId: playlist.id, text: "Chenille" });
      await expect(caller.content.drawingPrompt.update({ token, promptId: prompt.id, text: "   " })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    });

    it("rejects a non-positive or non-integer duration", async () => {
      const token = await freshHost();
      const playlist = await caller.content.drawingPlaylist.create({ token, gameKey: "drawing", name: "Test" });
      const prompt = await caller.content.drawingPrompt.create({ token, playlistId: playlist.id, text: "Chenille" });
      await expect(caller.content.drawingPrompt.update({ token, promptId: prompt.id, durationSeconds: 0 })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      await expect(caller.content.drawingPrompt.update({ token, promptId: prompt.id, durationSeconds: -5 })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    });

    it("Clear text drops a ready prompt back to incomplete — clearing must persist", async () => {
      const token = await freshHost();
      const playlist = await caller.content.drawingPlaylist.create({ token, gameKey: "drawing", name: "Test" });
      const prompt = await caller.content.drawingPrompt.create({ token, playlistId: playlist.id, text: "Chenille" });
      await caller.content.drawingPrompt.update({ token, promptId: prompt.id, text: null });
      const detail = await caller.content.drawingPlaylist.get({ token, playlistId: playlist.id });
      expect(detail.prompts[0]!.text).toBeNull();
      expect(detail.readiness.status).toBe("incomplete");
    });

    it("deletes a prompt and reorders the remaining ones", async () => {
      const token = await freshHost();
      const playlist = await freshReadyPlaylist(token);
      const before = await caller.content.drawingPlaylist.get({ token, playlistId: playlist.id });
      const [first, second] = before.prompts;

      await caller.content.drawingPrompt.delete({ token, promptId: first!.id });
      const after = await caller.content.drawingPlaylist.get({ token, playlistId: playlist.id });
      expect(after.prompts.map((p) => p.id)).toEqual([second!.id]);
    });

    it("duplicates a prompt — text and duration copied, a new id, the original untouched", async () => {
      const token = await freshHost();
      const playlist = await freshReadyPlaylist(token);
      const before = await caller.content.drawingPlaylist.get({ token, playlistId: playlist.id });
      const source = before.prompts[0]!;

      const copy = await caller.content.drawingPrompt.duplicate({ token, promptId: source.id });
      expect(copy.id).not.toBe(source.id);
      expect(copy.text).toBe(source.text);
      expect(copy.durationSeconds).toBe(source.durationSeconds);

      const after = await caller.content.drawingPlaylist.get({ token, playlistId: playlist.id });
      expect(after.prompts.map((p) => p.id)).toEqual([source.id, before.prompts[1]!.id, copy.id]);
    });

    it("reorders prompts, and rejects a reorder list that doesn't match exactly", async () => {
      const token = await freshHost();
      const playlist = await freshReadyPlaylist(token);
      const before = await caller.content.drawingPlaylist.get({ token, playlistId: playlist.id });
      const [first, second] = before.prompts;

      await caller.content.drawingPrompt.reorder({ token, playlistId: playlist.id, orderedPromptIds: [second!.id, first!.id] });
      const after = await caller.content.drawingPlaylist.get({ token, playlistId: playlist.id });
      expect(after.prompts.map((p) => p.id)).toEqual([second!.id, first!.id]);

      await expect(
        caller.content.drawingPrompt.reorder({ token, playlistId: playlist.id, orderedPromptIds: [first!.id] }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  describe("ownership / IDOR", () => {
    it("Host A cannot read, update, or delete Host B's playlist", async () => {
      const tokenA = await freshHost();
      const tokenB = await freshHost();
      const playlistA = await caller.content.drawingPlaylist.create({ token: tokenA, gameKey: "drawing", name: "A's prompts" });

      await expect(caller.content.drawingPlaylist.get({ token: tokenB, playlistId: playlistA.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        caller.content.drawingPlaylist.update({ token: tokenB, playlistId: playlistA.id, name: "Hijacked" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(caller.content.drawingPlaylist.delete({ token: tokenB, playlistId: playlistA.id })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });

      const stillA = await caller.content.drawingPlaylist.get({ token: tokenA, playlistId: playlistA.id });
      expect(stillA.name).toBe("A's prompts");
    });

    it("Host A cannot create, update, or delete a prompt on Host B's playlist", async () => {
      const tokenA = await freshHost();
      const tokenB = await freshHost();
      const playlistA = await freshReadyPlaylist(tokenA);
      const detail = await caller.content.drawingPlaylist.get({ token: tokenA, playlistId: playlistA.id });
      const promptA = detail.prompts[0]!;

      await expect(caller.content.drawingPrompt.create({ token: tokenB, playlistId: playlistA.id })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(caller.content.drawingPrompt.update({ token: tokenB, promptId: promptA.id, text: "Hijacked" })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(caller.content.drawingPrompt.delete({ token: tokenB, promptId: promptA.id })).rejects.toMatchObject({
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

    it("starts a Drawing game using the Host's prepared playlist, not the sample prompts", async () => {
      const contentToken = await freshHost();
      const playlist = await freshReadyPlaylist(contentToken);
      const { session, hostToken } = await hostedSession();

      const started = await caller.game.start({
        token: hostToken,
        gameKey: "drawing",
        content: { type: "playlist", playlistId: playlist.id, contentToken },
      });
      expect(started.ok).toBe(true);
      expect(started.gameKey).toBe("drawing");

      const game = await getCurrentGame(session.id);
      expect(game?.playlistId).toBe(playlist.id);
      const state = game?.internalState as { prompts: { text: string; durationSeconds: number }[] };
      expect(state.prompts.map((p) => [p.text, p.durationSeconds])).toEqual([
        ["Chenille", 45],
        ["Dragon", 30],
      ]);
    });

    it("falls back to the built-in sample prompts when no content is chosen", async () => {
      const { session, hostToken } = await hostedSession();
      const started = await caller.game.start({ token: hostToken, gameKey: "drawing" });
      expect(started.ok).toBe(true);
      const game = await getCurrentGame(session.id);
      expect(game?.playlistId).toBeNull();
      const state = game?.internalState as { prompts: unknown[] };
      expect(state.prompts.length).toBeGreaterThan(0);
    });

    it("rejects starting a Drawing game with another host's playlist (IDOR-safe)", async () => {
      const contentTokenA = await freshHost();
      const playlistA = await freshReadyPlaylist(contentTokenA);
      const contentTokenB = await freshHost();
      const { hostToken } = await hostedSession();

      await expect(
        caller.game.start({
          token: hostToken,
          gameKey: "drawing",
          content: { type: "playlist", playlistId: playlistA.id, contentToken: contentTokenB },
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("a playlist deleted AFTER the Host selected it fails Start Game cleanly — no crash, no SessionGame row", async () => {
      const contentToken = await freshHost();
      const playlist = await freshReadyPlaylist(contentToken);
      const { session, hostToken } = await hostedSession();

      await caller.content.drawingPlaylist.delete({ token: contentToken, playlistId: playlist.id });

      await expect(
        caller.game.start({
          token: hostToken,
          gameKey: "drawing",
          content: { type: "playlist", playlistId: playlist.id, contentToken },
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });

      expect(await getCurrentGame(session.id)).toBeNull();
    });

    it("refuses to start with an incomplete Drawing playlist, and never creates a SessionGame row for it", async () => {
      const contentToken = await freshHost();
      const playlist = await caller.content.drawingPlaylist.create({ token: contentToken, gameKey: "drawing", name: "Incomplete" });
      await caller.content.drawingPrompt.create({ token: contentToken, playlistId: playlist.id }); // no text — never completed
      const { session, hostToken } = await hostedSession();

      await expect(
        caller.game.start({
          token: hostToken,
          gameKey: "drawing",
          content: { type: "playlist", playlistId: playlist.id, contentToken },
        }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

      expect(await getCurrentGame(session.id)).toBeNull();
    });

    it("plays prompts in exactly the persisted reorder, not creation order", async () => {
      const contentToken = await freshHost();
      const playlist = await freshReadyPlaylist(contentToken); // created as [Chenille, Dragon]
      const before = await caller.content.drawingPlaylist.get({ token: contentToken, playlistId: playlist.id });
      const [first, second] = before.prompts;

      await caller.content.drawingPrompt.reorder({ token: contentToken, playlistId: playlist.id, orderedPromptIds: [second!.id, first!.id] });

      const { session, hostToken } = await hostedSession();
      await caller.game.start({ token: hostToken, gameKey: "drawing", content: { type: "playlist", playlistId: playlist.id, contentToken } });

      const game = await getCurrentGame(session.id);
      const state = game?.internalState as { prompts: { text: string }[] };
      expect(state.prompts.map((p) => p.text)).toEqual(["Dragon", "Chenille"]);
    });

    it("editing a Drawing playlist after a game has started never changes the running game's snapshot", async () => {
      const contentToken = await freshHost();
      const playlist = await freshReadyPlaylist(contentToken);
      const { session, hostToken } = await hostedSession();
      await caller.game.start({ token: hostToken, gameKey: "drawing", content: { type: "playlist", playlistId: playlist.id, contentToken } });

      const detail = await caller.content.drawingPlaylist.get({ token: contentToken, playlistId: playlist.id });
      await caller.content.drawingPrompt.update({ token: contentToken, promptId: detail.prompts[0]!.id, text: "Edited mid-game" });

      const game = await getCurrentGame(session.id);
      const state = game?.internalState as { prompts: { text: string }[] };
      expect(state.prompts[0]!.text).toBe("Chenille"); // untouched snapshot, not the live edit
    });
  });
});
