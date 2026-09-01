import { afterAll, describe, expect, it } from "vitest";
import { appRouter } from "@/server/trpc/router";
import { createContentHost } from "@/server/db/contentHost";
import { createSession } from "@/server/db/session";
import { joinSession } from "@/server/db/participant";
import { getCurrentGame } from "@/server/game";
import { prisma } from "@/server/db/client";
import { DEV_PLAYGROUND_HOST_PASSWORD } from "@/domain/session";

/**
 * Guess the Music's Content Studio — the Music counterpart to
 * content-geo.test.ts/content-drawing.test.ts, same shape (direct
 * DB/tRPC calls via `appRouter.createCaller({})`, no HTTP/socket server
 * needed), covering contentMusicRouter.ts + contentMusic.ts + the music
 * branch of `game.start` in router.ts. No other game's own content test
 * file is touched.
 */
describe("Content Studio — Music", () => {
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
    const playlist = await caller.content.musicPlaylist.create({ token, gameKey: "music", name: "Friday Night Mix" });
    const t1 = await caller.content.musicTrack.create({ token, playlistId: playlist.id, title: "Bohemian Rhapsody" });
    await caller.content.musicTrack.update({ token, trackId: t1.id, audioUrl: "/audio/music/sample-tone.wav", artist: "Queen" });
    const t2 = await caller.content.musicTrack.create({ token, playlistId: playlist.id, title: "Take On Me" });
    await caller.content.musicTrack.update({ token, trackId: t2.id, audioUrl: "/audio/music/sample-tone.wav" });
    return playlist;
  }

  describe("playlist CRUD", () => {
    it("creates, lists, and reads back an empty playlist as not-ready", async () => {
      const token = await freshHost();
      const playlist = await caller.content.musicPlaylist.create({ token, gameKey: "music", name: "Test Playlist" });
      expect(playlist.readiness.status).toBe("empty");

      const list = await caller.content.musicPlaylist.list({ token, gameKey: "music" });
      expect(list.some((p) => p.id === playlist.id)).toBe(true);

      const detail = await caller.content.musicPlaylist.get({ token, playlistId: playlist.id });
      expect(detail.tracks).toEqual([]);
      expect(detail.inUse).toBe(false);
    });

    it("rejects an empty name", async () => {
      const token = await freshHost();
      await expect(caller.content.musicPlaylist.create({ token, gameKey: "music", name: "   " })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    });

    it("renames and deletes a playlist", async () => {
      const token = await freshHost();
      const playlist = await caller.content.musicPlaylist.create({ token, gameKey: "music", name: "Original" });
      const renamed = await caller.content.musicPlaylist.update({ token, playlistId: playlist.id, name: "Renamed" });
      expect(renamed.name).toBe("Renamed");

      await caller.content.musicPlaylist.delete({ token, playlistId: playlist.id });
      await expect(caller.content.musicPlaylist.get({ token, playlistId: playlist.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("duplicates a playlist, including its tracks (audio + title + artist), as a genuinely independent copy", async () => {
      const token = await freshHost();
      const playlist = await freshReadyPlaylist(token);
      const copy = await caller.content.musicPlaylist.duplicate({ token, playlistId: playlist.id });
      expect(copy.id).not.toBe(playlist.id);
      expect(copy.name).toBe(`${playlist.name} (Copy)`);

      const copyDetail = await caller.content.musicPlaylist.get({ token, playlistId: copy.id });
      expect(copyDetail.tracks.map((t) => [t.title, t.artist, t.audioUrl])).toEqual([
        ["Bohemian Rhapsody", "Queen", "/audio/music/sample-tone.wav"],
        ["Take On Me", null, "/audio/music/sample-tone.wav"],
      ]);

      // Genuinely independent — editing the copy doesn't touch the original.
      await caller.content.musicTrack.update({ token, trackId: copyDetail.tracks[0]!.id, title: "Edited" });
      const originalDetail = await caller.content.musicPlaylist.get({ token, playlistId: playlist.id });
      expect(originalDetail.tracks[0]!.title).toBe("Bohemian Rhapsody");
    });
  });

  describe("track CRUD and readiness", () => {
    it("a fresh track is an empty shell — not-ready until audio and title are both set", async () => {
      const token = await freshHost();
      const playlist = await caller.content.musicPlaylist.create({ token, gameKey: "music", name: "Test" });
      const track = await caller.content.musicTrack.create({ token, playlistId: playlist.id });
      expect(track.title).toBeNull();
      expect(track.audioUrl).toBeNull();
      expect(track.artist).toBeNull();

      let detail = await caller.content.musicPlaylist.get({ token, playlistId: playlist.id });
      expect(detail.readiness.status).toBe("incomplete"); // a shell row exists -> incomplete, not empty

      await caller.content.musicTrack.update({ token, trackId: track.id, title: "Bohemian Rhapsody" });
      detail = await caller.content.musicPlaylist.get({ token, playlistId: playlist.id });
      expect(detail.readiness.status).toBe("incomplete"); // title alone isn't enough

      await caller.content.musicTrack.update({ token, trackId: track.id, audioUrl: "/audio/music/sample-tone.wav" });
      detail = await caller.content.musicPlaylist.get({ token, playlistId: playlist.id });
      expect(detail.readiness.status).toBe("ready"); // artist stays optional
    });

    it("rejects blank (but non-null) title, audioUrl, or artist", async () => {
      const token = await freshHost();
      const playlist = await caller.content.musicPlaylist.create({ token, gameKey: "music", name: "Test" });
      const track = await caller.content.musicTrack.create({ token, playlistId: playlist.id, title: "X" });
      await expect(caller.content.musicTrack.update({ token, trackId: track.id, title: "   " })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(caller.content.musicTrack.update({ token, trackId: track.id, audioUrl: "   " })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(caller.content.musicTrack.update({ token, trackId: track.id, artist: "   " })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("clearing audioUrl (remove clip) drops a ready track back to incomplete — clearing must persist", async () => {
      const token = await freshHost();
      const playlist = await freshReadyPlaylist(token);
      const before = await caller.content.musicPlaylist.get({ token, playlistId: playlist.id });
      const track = before.tracks[0]!;

      await caller.content.musicTrack.update({ token, trackId: track.id, audioUrl: null });
      const detail = await caller.content.musicPlaylist.get({ token, playlistId: playlist.id });
      const updated = detail.tracks.find((t) => t.id === track.id)!;
      expect(updated.audioUrl).toBeNull(); // re-read confirms null, not the old value re-appearing
      expect(detail.readiness.status).toBe("incomplete");
    });

    it("replacing audioUrl overwrites the old one, title/artist untouched, readiness stays ready", async () => {
      const token = await freshHost();
      const playlist = await freshReadyPlaylist(token);
      const before = await caller.content.musicPlaylist.get({ token, playlistId: playlist.id });
      const track = before.tracks[0]!;

      await caller.content.musicTrack.update({ token, trackId: track.id, audioUrl: "/audio/music/other.wav" });
      const detail = await caller.content.musicPlaylist.get({ token, playlistId: playlist.id });
      const updated = detail.tracks.find((t) => t.id === track.id)!;
      expect(updated.audioUrl).toBe("/audio/music/other.wav");
      expect(updated.title).toBe("Bohemian Rhapsody");
      expect(updated.artist).toBe("Queen");
      expect(detail.readiness.status).toBe("ready");
    });

    it("deletes a track and leaves the remaining one behind", async () => {
      const token = await freshHost();
      const playlist = await freshReadyPlaylist(token);
      const before = await caller.content.musicPlaylist.get({ token, playlistId: playlist.id });
      const [first, second] = before.tracks;

      await caller.content.musicTrack.delete({ token, trackId: first!.id });
      const after = await caller.content.musicPlaylist.get({ token, playlistId: playlist.id });
      expect(after.tracks.map((t) => t.id)).toEqual([second!.id]);
    });

    it("duplicates a track — audio/title/artist copied, a new id, the original untouched", async () => {
      const token = await freshHost();
      const playlist = await freshReadyPlaylist(token);
      const before = await caller.content.musicPlaylist.get({ token, playlistId: playlist.id });
      const source = before.tracks[0]!;

      const copy = await caller.content.musicTrack.duplicate({ token, trackId: source.id });
      expect(copy.id).not.toBe(source.id);
      expect(copy.title).toBe(`${source.title} (Copy)`);
      expect(copy.audioUrl).toBe(source.audioUrl);
      expect(copy.artist).toBe(source.artist);

      const after = await caller.content.musicPlaylist.get({ token, playlistId: playlist.id });
      expect(after.tracks.map((t) => t.id)).toEqual([source.id, before.tracks[1]!.id, copy.id]);
    });

    it("reorders tracks, and rejects a reorder list that doesn't match exactly", async () => {
      const token = await freshHost();
      const playlist = await freshReadyPlaylist(token);
      const before = await caller.content.musicPlaylist.get({ token, playlistId: playlist.id });
      const [first, second] = before.tracks;

      await caller.content.musicTrack.reorder({ token, playlistId: playlist.id, orderedTrackIds: [second!.id, first!.id] });
      const after = await caller.content.musicPlaylist.get({ token, playlistId: playlist.id });
      expect(after.tracks.map((t) => t.id)).toEqual([second!.id, first!.id]);

      await expect(
        caller.content.musicTrack.reorder({ token, playlistId: playlist.id, orderedTrackIds: [first!.id] }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  describe("ownership / IDOR", () => {
    it("Host A cannot read, update, or delete Host B's playlist", async () => {
      const tokenA = await freshHost();
      const tokenB = await freshHost();
      const playlistA = await caller.content.musicPlaylist.create({ token: tokenA, gameKey: "music", name: "A's playlist" });

      await expect(caller.content.musicPlaylist.get({ token: tokenB, playlistId: playlistA.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        caller.content.musicPlaylist.update({ token: tokenB, playlistId: playlistA.id, name: "Hijacked" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(caller.content.musicPlaylist.delete({ token: tokenB, playlistId: playlistA.id })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });

      const stillA = await caller.content.musicPlaylist.get({ token: tokenA, playlistId: playlistA.id });
      expect(stillA.name).toBe("A's playlist");
    });

    it("Host A cannot create, update, or delete a track on Host B's playlist", async () => {
      const tokenA = await freshHost();
      const tokenB = await freshHost();
      const playlistA = await freshReadyPlaylist(tokenA);
      const detail = await caller.content.musicPlaylist.get({ token: tokenA, playlistId: playlistA.id });
      const trackA = detail.tracks[0]!;

      await expect(caller.content.musicTrack.create({ token: tokenB, playlistId: playlistA.id })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(caller.content.musicTrack.update({ token: tokenB, trackId: trackA.id, title: "Hijacked" })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(caller.content.musicTrack.delete({ token: tokenB, trackId: trackA.id })).rejects.toMatchObject({
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

    it("starts a Music game using the Host's prepared playlist, not the sample tracks", async () => {
      const contentToken = await freshHost();
      const playlist = await freshReadyPlaylist(contentToken);
      const { session, hostToken } = await hostedSession();

      const started = await caller.game.start({
        token: hostToken,
        gameKey: "music",
        content: { type: "playlist", playlistId: playlist.id, contentToken },
      });
      expect(started.ok).toBe(true);
      expect(started.gameKey).toBe("music");

      const game = await getCurrentGame(session.id);
      expect(game?.playlistId).toBe(playlist.id);
      const state = game?.internalState as { rounds: { title: string; artist?: string }[] };
      expect(state.rounds.map((r) => r.title)).toEqual(["Bohemian Rhapsody", "Take On Me"]);
    });

    it("falls back to the built-in sample tracks when no content is chosen", async () => {
      const { session, hostToken } = await hostedSession();
      const started = await caller.game.start({ token: hostToken, gameKey: "music" });
      expect(started.ok).toBe(true);
      const game = await getCurrentGame(session.id);
      expect(game?.playlistId).toBeNull();
      const state = game?.internalState as { rounds: unknown[] };
      expect(state.rounds.length).toBeGreaterThan(0);
    });

    it("rejects starting a Music game with another host's playlist (IDOR-safe)", async () => {
      const contentTokenA = await freshHost();
      const playlistA = await freshReadyPlaylist(contentTokenA);
      const contentTokenB = await freshHost();
      const { hostToken } = await hostedSession();

      await expect(
        caller.game.start({
          token: hostToken,
          gameKey: "music",
          content: { type: "playlist", playlistId: playlistA.id, contentToken: contentTokenB },
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("a playlist deleted AFTER the Host selected it fails Start Game cleanly — no crash, no SessionGame row", async () => {
      const contentToken = await freshHost();
      const playlist = await freshReadyPlaylist(contentToken);
      const { session, hostToken } = await hostedSession();

      await caller.content.musicPlaylist.delete({ token: contentToken, playlistId: playlist.id });

      await expect(
        caller.game.start({
          token: hostToken,
          gameKey: "music",
          content: { type: "playlist", playlistId: playlist.id, contentToken },
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });

      expect(await getCurrentGame(session.id)).toBeNull();
    });

    it("refuses to start with an incomplete Music playlist, and never creates a SessionGame row for it", async () => {
      const contentToken = await freshHost();
      const playlist = await caller.content.musicPlaylist.create({ token: contentToken, gameKey: "music", name: "Incomplete" });
      await caller.content.musicTrack.create({ token: contentToken, playlistId: playlist.id }); // no audio/title — never completed
      const { session, hostToken } = await hostedSession();

      await expect(
        caller.game.start({
          token: hostToken,
          gameKey: "music",
          content: { type: "playlist", playlistId: playlist.id, contentToken },
        }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

      expect(await getCurrentGame(session.id)).toBeNull();
    });

    it("plays tracks in exactly the persisted reorder, not creation order", async () => {
      const contentToken = await freshHost();
      const playlist = await freshReadyPlaylist(contentToken); // created as [Bohemian Rhapsody, Take On Me]
      const before = await caller.content.musicPlaylist.get({ token: contentToken, playlistId: playlist.id });
      const [first, second] = before.tracks;

      await caller.content.musicTrack.reorder({ token: contentToken, playlistId: playlist.id, orderedTrackIds: [second!.id, first!.id] });

      const { session, hostToken } = await hostedSession();
      await caller.game.start({ token: hostToken, gameKey: "music", content: { type: "playlist", playlistId: playlist.id, contentToken } });

      const game = await getCurrentGame(session.id);
      const state = game?.internalState as { rounds: { title: string }[] };
      expect(state.rounds.map((r) => r.title)).toEqual(["Take On Me", "Bohemian Rhapsody"]);
    });

    it("editing a Music playlist after a game has started never changes the running game's snapshot", async () => {
      const contentToken = await freshHost();
      const playlist = await freshReadyPlaylist(contentToken);
      const { session, hostToken } = await hostedSession();
      await caller.game.start({ token: hostToken, gameKey: "music", content: { type: "playlist", playlistId: playlist.id, contentToken } });

      const detail = await caller.content.musicPlaylist.get({ token: contentToken, playlistId: playlist.id });
      await caller.content.musicTrack.update({ token: contentToken, trackId: detail.tracks[0]!.id, title: "Edited mid-game" });

      const game = await getCurrentGame(session.id);
      const state = game?.internalState as { rounds: { title: string }[] };
      expect(state.rounds[0]!.title).toBe("Bohemian Rhapsody"); // untouched snapshot, not the live edit
    });
  });

  describe("asset pool", () => {
    it("lists whatever audio files exist under public/audio/music, including the bundled sample tone", async () => {
      const assets = await caller.content.musicAsset.list();
      expect(assets.some((a) => a.url === "/audio/music/sample-tone.wav")).toBe(true);
    });

    it("deleting a clip is gated behind a real ContentHost token", async () => {
      await expect(caller.content.musicAsset.delete({ token: "not-a-real-token", url: "/audio/music/does-not-exist.wav" })).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    });
  });
});
