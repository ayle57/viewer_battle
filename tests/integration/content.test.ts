import { afterAll, describe, expect, it } from "vitest";
import { appRouter } from "@/server/trpc/router";
import { createContentHost } from "@/server/db/contentHost";
import * as content from "@/server/db/content";
import { createSession } from "@/server/db/session";
import { joinSession } from "@/server/db/participant";
import { getCurrentGame, applyGameAction } from "@/server/game";
import { prisma } from "@/server/db/client";
import { DEV_PLAYGROUND_HOST_PASSWORD } from "@/domain/session";

/**
 * Content Studio — src/server/db/content.ts + src/server/db/contentHost.ts
 * directly (the Prisma-backed CRUD, ownership, and validation rules), plus
 * the tRPC surface (src/server/trpc/contentRouter.ts, and `game.start`'s
 * playlist-selection branch in src/server/trpc/router.ts) via
 * `appRouter.createCaller({})` — no HTTP/socket server needed since
 * neither router reads request context, same reasoning as
 * game-service.test.ts calling the bridge functions directly.
 */
describe("Content Studio", () => {
  const createdSessionIds = new Set<string>();
  const caller = appRouter.createCaller({});
  // Everything this file's ContentHost cleanup removes is scoped to rows
  // created from THIS moment on — never a blanket `contentHost.deleteMany({})`.
  // This app has exactly ONE real ContentHost (the streamer —
  // signInContentHost's own doc comment: "there is exactly one real Host
  // identity in practice"), and a global delete here destroyed that same
  // real row — and cascaded onto every real Playlist/Category/Question
  // under it — the next time this suite ran, with zero relation to what
  // any individual test actually exercised. This was a REAL, reported bug
  // ("playlists keep disappearing"), not a hypothetical: `pnpm test`
  // periodically wiped the streamer's actual prepared content. A
  // timestamp cutoff (not per-call `hostId` tracking, which this file's
  // three `auth.login` calls below don't return anyway) is what makes
  // this genuinely exhaustive — nothing created during this run's window
  // can be missed, from any call site, present or future.
  const suiteStartedAt = new Date();

  // Playlists created directly under the ONE real, pre-existing
  // ContentHost (via `auth.login` -> signInContentHost, not `freshHost()`)
  // — the ContentHost timestamp-cutoff cascade below can't reach these
  // (their host row predates this run), so they leak one junk playlist
  // into the real Content Studio on every `pnpm test` unless tracked and
  // deleted explicitly here. The "reattach" test is the only such case.
  const createdRealPlaylistIds = new Set<string>();

  afterAll(async () => {
    await prisma.session.deleteMany({ where: { id: { in: Array.from(createdSessionIds) } } });
    await prisma.playlist.deleteMany({ where: { id: { in: Array.from(createdRealPlaylistIds) } } });
    await prisma.contentHost.deleteMany({ where: { createdAt: { gte: suiteStartedAt } } });
    await prisma.$disconnect();
  });

  async function freshHost() {
    const { token } = await createContentHost(DEV_PLAYGROUND_HOST_PASSWORD);
    return token;
  }

  async function freshPlaylistWithBoard(token: string) {
    const playlist = await caller.content.playlist.create({ token, gameKey: "board-question", name: "Friday Night Stream" });
    const geo = await caller.content.category.create({ token, playlistId: playlist.id, name: "Geography" });
    const sci = await caller.content.category.create({ token, playlistId: playlist.id, name: "Science" });
    await caller.content.question.create({ token, categoryId: geo.id, value: 100, prompt: "Longest river?", answer: "The Amazon" });
    await caller.content.question.create({ token, categoryId: geo.id, value: 200, prompt: "Smallest country?", answer: "Vatican City" });
    await caller.content.question.create({ token, categoryId: sci.id, value: 100, prompt: "Gold symbol?", answer: "Au" });
    return playlist;
  }

  describe("auth", () => {
    it("rejects the wrong password", async () => {
      await expect(caller.content.auth.login({ hostPassword: "definitely-wrong" })).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    });

    it("issues a working token for the right password", async () => {
      const { token } = await caller.content.auth.login({ hostPassword: DEV_PLAYGROUND_HOST_PASSWORD });
      expect(token).toBeTruthy();
      await expect(caller.content.auth.me({ token })).resolves.toEqual({ ok: true });
    });

    it("signing in again (a new browser/device) reattaches to the SAME Content Studio identity and its existing playlists, not a fresh empty one", async () => {
      // The real product's login path (auth.login -> signInContentHost),
      // not `freshHost()`/`createContentHost` — this app is single-
      // streamer (see AGENTS.md "Session invariants"), so a second real
      // sign-in must never orphan whatever the first session already
      // built.
      const { token: firstToken } = await caller.content.auth.login({ hostPassword: DEV_PLAYGROUND_HOST_PASSWORD });
      const playlist = await caller.content.playlist.create({ token: firstToken, gameKey: "board-question", name: "Reattach Test" });
      createdRealPlaylistIds.add(playlist.id); // created under the real ContentHost — clean it up explicitly (see afterAll)

      const { token: secondToken } = await caller.content.auth.login({ hostPassword: DEV_PLAYGROUND_HOST_PASSWORD });
      expect(secondToken).not.toBe(firstToken);

      // The new token sees the playlist the old token created — same host.
      const list = await caller.content.playlist.list({ token: secondToken, gameKey: "board-question" });
      expect(list.some((p) => p.id === playlist.id)).toBe(true);
      await expect(caller.content.playlist.get({ token: secondToken, playlistId: playlist.id })).resolves.toMatchObject({
        id: playlist.id,
      });

      // A fresh token replaces the old one — same single-active-credential
      // posture as every other identity in this app, not two valid tokens.
      await expect(caller.content.auth.me({ token: firstToken })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("rejects a garbage token", async () => {
      await expect(caller.content.auth.me({ token: "not-a-real-token" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("a session Participant's token is not a valid content token (separate identity systems)", async () => {
      const session = await createSession();
      createdSessionIds.add(session.id);
      const host = await joinSession({ sessionCode: session.code, role: "HOST", displayName: "Alex" });
      await expect(caller.content.playlist.list({ token: host.token, gameKey: "board-question" })).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    });

    it("Player and Display session tokens cannot touch Content Studio either — same rejection, same mechanism", async () => {
      const session = await createSession();
      createdSessionIds.add(session.id);
      const { generateToken, hashToken } = await import("@/server/auth/token");
      const playerToken = generateToken();
      const displayToken = generateToken();
      await prisma.participant.create({
        data: { sessionId: session.id, role: "TEAM_A", seat: 1, displayName: "Sam", tokenHash: hashToken(playerToken) },
      });
      await prisma.participant.create({
        data: { sessionId: session.id, role: "DISPLAY", displayName: "OBS", tokenHash: hashToken(displayToken) },
      });

      await expect(caller.content.playlist.list({ token: playerToken, gameKey: "board-question" })).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
      await expect(caller.content.playlist.create({ token: playerToken, gameKey: "board-question", name: "x" })).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
      await expect(caller.content.playlist.list({ token: displayToken, gameKey: "board-question" })).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
      await expect(caller.content.playlist.create({ token: displayToken, gameKey: "board-question", name: "x" })).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    });
  });

  describe("playlist CRUD", () => {
    it("Host can create a playlist", async () => {
      const token = await freshHost();
      const playlist = await caller.content.playlist.create({ token, gameKey: "board-question", name: "Community Night" });
      expect(playlist.name).toBe("Community Night");
      expect(playlist.categoryCount).toBe(0);
      expect(playlist.questionCount).toBe(0);
    });

    it("Host can rename and re-describe a playlist", async () => {
      const token = await freshHost();
      const playlist = await caller.content.playlist.create({ token, gameKey: "board-question", name: "Draft" });
      const updated = await caller.content.playlist.update({
        token,
        playlistId: playlist.id,
        name: "Final Board",
        description: "Live Friday",
      });
      expect(updated.name).toBe("Final Board");
      expect(updated.description).toBe("Live Friday");
    });

    it("rejects an empty playlist name", async () => {
      const token = await freshHost();
      await expect(caller.content.playlist.create({ token, gameKey: "board-question", name: "   " })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    });

    it("Host can delete a playlist, cascading its categories and questions", async () => {
      const token = await freshHost();
      const playlist = await freshPlaylistWithBoard(token);
      await caller.content.playlist.delete({ token, playlistId: playlist.id });
      await expect(caller.content.playlist.get({ token, playlistId: playlist.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("Host can duplicate a playlist into an independent copy", async () => {
      const token = await freshHost();
      const playlist = await freshPlaylistWithBoard(token);
      const copy = await caller.content.playlist.duplicate({ token, playlistId: playlist.id });

      expect(copy.id).not.toBe(playlist.id);
      expect(copy.categoryCount).toBe(2);
      expect(copy.questionCount).toBe(3);

      // Editing the copy must not touch the original.
      const copyDetail = await caller.content.playlist.get({ token, playlistId: copy.id });
      const copyCategory = copyDetail.categories[0];
      await caller.content.category.rename({ token, categoryId: copyCategory!.id, name: "Renamed" });

      const originalDetail = await caller.content.playlist.get({ token, playlistId: playlist.id });
      expect(originalDetail.categories.map((c) => c.name)).not.toContain("Renamed");
    });

    it("lists playlists newest-edited first with accurate counts", async () => {
      const token = await freshHost();
      await freshPlaylistWithBoard(token);
      const list = await caller.content.playlist.list({ token, gameKey: "board-question" });
      expect(list).toHaveLength(1);
      expect(list[0]!.categoryCount).toBe(2);
      expect(list[0]!.questionCount).toBe(3);
    });
  });

  describe("category + question CRUD", () => {
    it("Host can create, rename, and delete a category", async () => {
      const token = await freshHost();
      const playlist = await caller.content.playlist.create({ token, gameKey: "board-question", name: "Board" });
      const category = await caller.content.category.create({ token, playlistId: playlist.id, name: "Movies" });
      await caller.content.category.rename({ token, categoryId: category.id, name: "Films" });

      let detail = await caller.content.playlist.get({ token, playlistId: playlist.id });
      expect(detail.categories.map((c) => c.name)).toEqual(["Films"]);

      await caller.content.category.delete({ token, categoryId: category.id });
      detail = await caller.content.playlist.get({ token, playlistId: playlist.id });
      expect(detail.categories).toHaveLength(0);
    });

    it("Host can create, update, and delete a question", async () => {
      const token = await freshHost();
      const playlist = await caller.content.playlist.create({ token, gameKey: "board-question", name: "Board" });
      const category = await caller.content.category.create({ token, playlistId: playlist.id, name: "Geography" });
      const question = await caller.content.question.create({
        token,
        categoryId: category.id,
        value: 100,
        prompt: "Longest river?",
        answer: "Wrong answer",
      });

      const updated = await caller.content.question.update({ token, questionId: question.id, value: 200, answer: "The Amazon" });
      expect(updated.value).toBe(200);
      expect(updated.answer).toBe("The Amazon");
      expect(updated.prompt).toBe("Longest river?"); // untouched field survives a partial update

      await caller.content.question.delete({ token, questionId: question.id });
      const detail = await caller.content.playlist.get({ token, playlistId: playlist.id });
      expect(detail.categories[0]!.questions).toHaveLength(0);
    });

    it("Host can duplicate a question", async () => {
      const token = await freshHost();
      const playlist = await freshPlaylistWithBoard(token);
      const detail = await caller.content.playlist.get({ token, playlistId: playlist.id });
      const original = detail.categories[0]!.questions[0]!;

      const copy = await caller.content.question.duplicate({ token, questionId: original.id });
      expect(copy.id).not.toBe(original.id);
      expect(copy.prompt).toBe(original.prompt);
      expect(copy.categoryId).toBe(original.categoryId);
    });

    it("reorders questions within a category", async () => {
      const token = await freshHost();
      const playlist = await freshPlaylistWithBoard(token);
      const detail = await caller.content.playlist.get({ token, playlistId: playlist.id });
      const geo = detail.categories.find((c) => c.name === "Geography")!;
      const ids = geo.questions.map((q) => q.id);
      const reversed = [...ids].reverse();

      await caller.content.question.reorder({ token, categoryId: geo.id, orderedQuestionIds: reversed });
      const after = await caller.content.playlist.get({ token, playlistId: playlist.id });
      const afterIds = after.categories.find((c) => c.name === "Geography")!.questions.map((q) => q.id);
      expect(afterIds).toEqual(reversed);
    });

    it("rejects an invalid (non-matching) reorder list", async () => {
      const token = await freshHost();
      const playlist = await freshPlaylistWithBoard(token);
      const detail = await caller.content.playlist.get({ token, playlistId: playlist.id });
      const geo = detail.categories.find((c) => c.name === "Geography")!;

      await expect(
        caller.content.question.reorder({ token, categoryId: geo.id, orderedQuestionIds: ["not-a-real-id"] }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("rejects a zero/negative question value", async () => {
      const token = await freshHost();
      const playlist = await caller.content.playlist.create({ token, gameKey: "board-question", name: "Board" });
      const category = await caller.content.category.create({ token, playlistId: playlist.id, name: "Geography" });
      await expect(
        content.createQuestion("bad-host-id-but-validated-first", category.id, { value: 0, prompt: "x", answer: "y" }),
      ).rejects.toMatchObject({ code: "VALIDATION" });
    });
  });

  describe("ownership / IDOR", () => {
    it("Host A cannot read Host B's playlist", async () => {
      const tokenA = await freshHost();
      const tokenB = await freshHost();
      const playlistA = await caller.content.playlist.create({ token: tokenA, gameKey: "board-question", name: "A's board" });

      await expect(caller.content.playlist.get({ token: tokenB, playlistId: playlistA.id })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("Host A cannot rename, delete, or duplicate Host B's playlist", async () => {
      const tokenA = await freshHost();
      const tokenB = await freshHost();
      const playlistA = await caller.content.playlist.create({ token: tokenA, gameKey: "board-question", name: "A's board" });

      await expect(
        caller.content.playlist.update({ token: tokenB, playlistId: playlistA.id, name: "Hijacked" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(caller.content.playlist.delete({ token: tokenB, playlistId: playlistA.id })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(caller.content.playlist.duplicate({ token: tokenB, playlistId: playlistA.id })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });

      // The playlist genuinely survived, untouched.
      const stillA = await caller.content.playlist.get({ token: tokenA, playlistId: playlistA.id });
      expect(stillA.name).toBe("A's board");
    });

    it("Host A cannot create a category on, or touch a question inside, Host B's playlist", async () => {
      const tokenA = await freshHost();
      const tokenB = await freshHost();
      const playlistA = await freshPlaylistWithBoard(tokenA);
      const detail = await caller.content.playlist.get({ token: tokenA, playlistId: playlistA.id });
      const questionA = detail.categories[0]!.questions[0]!;
      const categoryA = detail.categories[0]!;

      await expect(
        caller.content.category.create({ token: tokenB, playlistId: playlistA.id, name: "Sneaky" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(caller.content.category.rename({ token: tokenB, categoryId: categoryA.id, name: "Hijacked" })).rejects.toMatchObject(
        { code: "NOT_FOUND" },
      );
      await expect(
        caller.content.question.update({ token: tokenB, questionId: questionA.id, answer: "Hijacked" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(caller.content.question.delete({ token: tokenB, questionId: questionA.id })).rejects.toMatchObject({
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

    it("starts a game using the Host's prepared playlist content, not the sample board", async () => {
      const contentToken = await freshHost();
      const playlist = await freshPlaylistWithBoard(contentToken);
      const { session, hostToken } = await hostedSession();

      const started = await caller.game.start({
        token: hostToken,
        gameKey: "board-question",
        content: { type: "playlist", playlistId: playlist.id, contentToken },
      });
      expect(started.ok).toBe(true);

      const game = await getCurrentGame(session.id);
      expect(game?.playlistId).toBe(playlist.id);
      const state = game?.internalState as { categories: { name: string }[]; questions: { prompt: string }[] };
      expect(state.categories.map((c) => c.name).sort()).toEqual(["Geography", "Science"]);
      expect(state.questions.map((q) => q.prompt)).toContain("Longest river?");
    });

    it("falls back to the sample board when no content is chosen (existing behavior, unchanged)", async () => {
      const { session, hostToken } = await hostedSession();
      const started = await caller.game.start({ token: hostToken, gameKey: "board-question" });
      expect(started.ok).toBe(true);
      const game = await getCurrentGame(session.id);
      expect(game?.playlistId).toBeNull();
      const state = game?.internalState as { categories: { name: string }[] };
      expect(state.categories.map((c) => c.name)).toEqual(["Geography", "Science", "Film"]);
    });

    it("rejects starting a game with another host's playlist (IDOR-safe)", async () => {
      const contentTokenA = await freshHost();
      const playlistA = await freshPlaylistWithBoard(contentTokenA);
      const contentTokenB = await freshHost();
      const { hostToken } = await hostedSession();

      await expect(
        caller.game.start({
          token: hostToken,
          gameKey: "board-question",
          content: { type: "playlist", playlistId: playlistA.id, contentToken: contentTokenB },
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("rejects starting a game with an incomplete playlist, and never creates a SessionGame row for it", async () => {
      const contentToken = await freshHost();
      const playlist = await freshPlaylistWithBoard(contentToken);
      const detail = await caller.content.playlist.get({ token: contentToken, playlistId: playlist.id });
      // Blank a question's answer directly at the DB layer — same
      // technique as the readiness describe block above — so the
      // playlist is genuinely "incomplete", not just missing entirely.
      await prisma.playlistQuestion.update({ where: { id: detail.categories[0]!.questions[0]!.id }, data: { answer: "" } });
      const { session, hostToken } = await hostedSession();

      await expect(
        caller.game.start({
          token: hostToken,
          gameKey: "board-question",
          content: { type: "playlist", playlistId: playlist.id, contentToken },
        }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

      // The refusal is real — no SessionGame row was left behind for a
      // config the engine would have rejected anyway.
      expect(await getCurrentGame(session.id)).toBeNull();
    });

    it("rejects starting a game with a playlist that has an empty category, even though every question that DOES exist is complete", async () => {
      const contentToken = await freshHost();
      const playlist = await caller.content.playlist.create({ token: contentToken, gameKey: "board-question", name: "Almost There" });
      const geo = await caller.content.category.create({ token: contentToken, playlistId: playlist.id, name: "Geography" });
      await caller.content.question.create({ token: contentToken, categoryId: geo.id, value: 100, prompt: "Longest river?", answer: "The Amazon" });
      // A second category with no questions at all yet — a real column
      // on the board with nothing to click, not a lighter form of ready.
      await caller.content.category.create({ token: contentToken, playlistId: playlist.id, name: "Science" });

      const detail = await caller.content.playlist.get({ token: contentToken, playlistId: playlist.id });
      expect(detail.readiness.status).toBe("incomplete");
      expect(detail.readiness.emptyCategories).toEqual([{ categoryId: expect.any(String), categoryName: "Science" }]);

      const { session, hostToken } = await hostedSession();
      await expect(
        caller.game.start({
          token: hostToken,
          gameKey: "board-question",
          content: { type: "playlist", playlistId: playlist.id, contentToken },
        }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(await getCurrentGame(session.id)).toBeNull();
    });

    it("a non-HOST participant cannot start a game at all, playlist or not", async () => {
      const contentToken = await freshHost();
      const playlist = await freshPlaylistWithBoard(contentToken);
      const { session } = await hostedSession();
      // A direct row insert, not joinSession — joining as TEAM_A for real
      // requires a genuinely connected HOST socket (see session.test.ts);
      // this test only needs a resolvable non-HOST token to exercise
      // game.start's role check, not the join flow itself.
      const { generateToken, hashToken } = await import("@/server/auth/token");
      const rawToken = generateToken();
      await prisma.participant.create({
        data: { sessionId: session.id, role: "TEAM_A", seat: 1, displayName: "Sam", tokenHash: hashToken(rawToken) },
      });

      await expect(
        caller.game.start({
          token: rawToken,
          gameKey: "board-question",
          content: { type: "playlist", playlistId: playlist.id, contentToken },
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("editing a playlist after a game has started never changes the running game's snapshot", async () => {
      const contentToken = await freshHost();
      const playlist = await freshPlaylistWithBoard(contentToken);
      const { session, hostToken } = await hostedSession();

      await caller.game.start({
        token: hostToken,
        gameKey: "board-question",
        content: { type: "playlist", playlistId: playlist.id, contentToken },
      });
      const beforeEdit = await getCurrentGame(session.id);
      const beforeState = beforeEdit?.internalState as { categories: { name: string }[] };

      // Live-edit the playlist mid-game: rename a category, add a new one.
      const detail = await caller.content.playlist.get({ token: contentToken, playlistId: playlist.id });
      await caller.content.category.rename({ token: contentToken, categoryId: detail.categories[0]!.id, name: "Renamed Live" });
      await caller.content.category.create({ token: contentToken, playlistId: playlist.id, name: "Added Live" });

      // Advance the actual game a bit, to prove it's still the untouched snapshot doing the work.
      const firstQuestionId = (beforeState as unknown as { questions: { id: string }[] }).questions[0]!.id;
      const acted = await applyGameAction(session.id, { type: "SELECT_QUESTION", by: "HOST", questionId: firstQuestionId });
      expect(acted.ok).toBe(true);

      const afterEdit = await getCurrentGame(session.id);
      const afterState = afterEdit?.internalState as { categories: { name: string }[] };
      expect(afterState.categories.map((c) => c.name).sort()).toEqual(beforeState.categories.map((c) => c.name).sort());
      expect(afterState.categories.map((c) => c.name)).not.toContain("Renamed Live");
      expect(afterState.categories.map((c) => c.name)).not.toContain("Added Live");

      // But the Playlist itself really did change, for the NEXT game.
      const playlistNow = await caller.content.playlist.get({ token: contentToken, playlistId: playlist.id });
      expect(playlistNow.categories.map((c) => c.name)).toContain("Renamed Live");
      expect(playlistNow.categories.map((c) => c.name)).toContain("Added Live");
    });

    it("Play Again with the same (now-edited) playlist picks up the new version in the next game", async () => {
      const contentToken = await freshHost();
      const playlist = await freshPlaylistWithBoard(contentToken);
      const { session, hostToken } = await hostedSession();

      await caller.game.start({
        token: hostToken,
        gameKey: "board-question",
        content: { type: "playlist", playlistId: playlist.id, contentToken },
      });
      // Finish the first game outright via END_GAME so a second one can start.
      await applyGameAction(session.id, { type: "END_GAME", by: "HOST" });

      // A category needs at least one question to keep the playlist
      // READY (see readiness.ts's "empty category" rule) — an empty
      // "Sports" here would correctly get this second `game.start`
      // rejected with PLAYLIST_NOT_READY, which isn't what this test is
      // about; give it real content instead.
      const sports = await caller.content.category.create({ token: contentToken, playlistId: playlist.id, name: "Sports" });
      await caller.content.question.create({ token: contentToken, categoryId: sports.id, value: 100, prompt: "Sport with a love-15-30 scoring quirk?", answer: "Tennis" });

      const again = await caller.game.start({
        token: hostToken,
        gameKey: "board-question",
        content: { type: "playlist", playlistId: playlist.id, contentToken },
      });
      expect(again.ok).toBe(true);

      const game = await getCurrentGame(session.id);
      const state = game?.internalState as { categories: { name: string }[] };
      expect(state.categories.map((c) => c.name)).toContain("Sports");
    });

    it("reports a playlist as in-use only while a game snapshotted from it is in progress", async () => {
      const contentToken = await freshHost();
      const playlist = await freshPlaylistWithBoard(contentToken);
      const { session, hostToken } = await hostedSession();

      let detail = await caller.content.playlist.get({ token: contentToken, playlistId: playlist.id });
      expect(detail.inUse).toBe(false);

      await caller.game.start({
        token: hostToken,
        gameKey: "board-question",
        content: { type: "playlist", playlistId: playlist.id, contentToken },
      });
      detail = await caller.content.playlist.get({ token: contentToken, playlistId: playlist.id });
      expect(detail.inUse).toBe(true);

      await applyGameAction(session.id, { type: "END_GAME", by: "HOST" });
      detail = await caller.content.playlist.get({ token: contentToken, playlistId: playlist.id });
      expect(detail.inUse).toBe(false);
    });
  });

  describe("readiness (Show Preparation pass)", () => {
    it("a brand-new empty playlist is 'empty', not 'ready' or 'incomplete'", async () => {
      const token = await freshHost();
      const playlist = await caller.content.playlist.create({ token, gameKey: "board-question", name: "Empty Board" });
      expect(playlist.readiness.status).toBe("empty");
      expect(playlist.readiness.ready).toBe(false);
    });

    it("a fully-filled playlist is 'ready', both from list and from get", async () => {
      const token = await freshHost();
      const playlist = await freshPlaylistWithBoard(token);
      expect(playlist.readiness.status).toBe("empty"); // create() alone has no categories yet

      const list = await caller.content.playlist.list({ token, gameKey: "board-question" });
      const listed = list.find((p) => p.id === playlist.id)!;
      expect(listed.readiness.status).toBe("ready");
      expect(listed.readiness.ready).toBe(true);
      expect(listed.readiness.questionCount).toBe(3);
      expect(listed.readiness.completeQuestionCount).toBe(3);

      const detail = await caller.content.playlist.get({ token, playlistId: playlist.id });
      expect(detail.readiness).toEqual(listed.readiness);
    });

    it("a question missing its answer flips the playlist to 'incomplete', flagged precisely", async () => {
      const token = await freshHost();
      const playlist = await freshPlaylistWithBoard(token);
      const detail = await caller.content.playlist.get({ token, playlistId: playlist.id });
      const target = detail.categories[0]!.questions[0]!;

      // Blank the answer directly at the DB layer (bypassing the tRPC
      // input validation, which rejects an empty string outright) — the
      // point here is that readiness independently re-derives
      // completeness from real stored data, not just from what the
      // mutation layer happened to accept on the way in.
      await prisma.playlistQuestion.update({ where: { id: target.id }, data: { answer: "" } });

      const list = await caller.content.playlist.list({ token, gameKey: "board-question" });
      const listed = list.find((p) => p.id === playlist.id)!;
      expect(listed.readiness.status).toBe("incomplete");
      expect(listed.readiness.ready).toBe(false);
      expect(listed.readiness.incompleteQuestions).toHaveLength(1);
      expect(listed.readiness.incompleteQuestions[0]).toMatchObject({ questionId: target.id, issues: ["MISSING_ANSWER"] });
      expect(listed.readiness.summary).toBe("1 question needs attention.");
    });

    it("a question missing its prompt is also flagged, independently of the answer check", async () => {
      const token = await freshHost();
      const playlist = await freshPlaylistWithBoard(token);
      const detail = await caller.content.playlist.get({ token, playlistId: playlist.id });
      const target = detail.categories[0]!.questions[1]!;

      await prisma.playlistQuestion.update({ where: { id: target.id }, data: { prompt: "" } });

      const after = await caller.content.playlist.get({ token, playlistId: playlist.id });
      expect(after.readiness.status).toBe("incomplete");
      expect(after.readiness.incompleteQuestions.map((q) => q.questionId)).toContain(target.id);
      expect(after.readiness.incompleteQuestions.find((q) => q.questionId === target.id)?.issues).toEqual(["MISSING_PROMPT"]);
    });

    it("duplicating a playlist produces independent content — readiness of the copy doesn't follow edits to the original, or vice versa", async () => {
      const token = await freshHost();
      const playlist = await freshPlaylistWithBoard(token);
      const copy = await caller.content.playlist.duplicate({ token, playlistId: playlist.id });
      expect(copy.readiness.status).toBe("ready"); // the copy starts fully ready, same as the source

      // Break a question in the COPY only.
      const copyDetail = await caller.content.playlist.get({ token, playlistId: copy.id });
      await caller.content.question.update({ token, questionId: copyDetail.categories[0]!.questions[0]!.id, prompt: "changed" });
      await prisma.playlistQuestion.update({ where: { id: copyDetail.categories[0]!.questions[1]!.id }, data: { answer: "" } });

      const copyAfter = await caller.content.playlist.get({ token, playlistId: copy.id });
      const originalAfter = await caller.content.playlist.get({ token, playlistId: playlist.id });
      expect(copyAfter.readiness.status).toBe("incomplete");
      expect(originalAfter.readiness.status).toBe("ready"); // untouched
    });
  });
});
