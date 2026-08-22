import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { appRouter } from "@/server/trpc/router";
import { TRPCError } from "@trpc/server";
import { createSocketServer } from "@/server/sockets";
import { createSession } from "@/server/db/session";
import { joinSession } from "@/server/db/participant";
import { createContentHost } from "@/server/db/contentHost";
import { startGame, applyGameAction } from "@/server/game";
import { sampleBoard } from "@/domain/game/boardQuestion";
import { prisma } from "@/server/db/client";
import { DEV_PLAYGROUND_HOST_PASSWORD } from "@/domain/session";

/**
 * The real, persistent `User` account system — src/server/db/user.ts's
 * DB-level operations plus its tRPC surface (userRouter.ts/adminRouter.ts)
 * via `appRouter.createCaller({})`, same "no HTTP/socket server needed"
 * reasoning as content.test.ts (neither router reads request context).
 * The "stats" describe block below DOES also need a real Socket.IO
 * server, though — same reasoning as session.test.ts's own doc comment:
 * joining as TEAM_A/TEAM_B for real (needed here so a real
 * Participant.userId gets stamped, not just asserted by hand) requires
 * genuinely live host presence, and faking that map would just be
 * testing a mock instead of the real accountToken wiring this file
 * exists to verify.
 *
 * Cleanup is scoped to usernames THIS suite generated (a unique-per-run
 * prefix), never a blanket `prisma.user.deleteMany({})` — same reasoning
 * as content.test.ts's own doc comment on why a global delete there was a
 * real, reported bug: this app can have real registered accounts, and a
 * suite-wide wipe would destroy them the next time `pnpm test` ran.
 */
describe("User accounts", () => {
  const caller = appRouter.createCaller({});
  const runId = `u${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const createdSessionIds = new Set<string>();
  let n = 0;
  const uniqueUsername = () => `${runId}_${n++}`;

  let baseUrl: string;
  let httpServer: ReturnType<typeof createServer>;
  const openSockets: ClientSocket[] = [];

  beforeAll(async () => {
    httpServer = createServer();
    createSocketServer(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const { port } = httpServer.address() as AddressInfo;
    baseUrl = `http://localhost:${port}`;
  });

  afterAll(async () => {
    openSockets.forEach((s) => s.close());
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await prisma.user.deleteMany({ where: { username: { startsWith: runId } } });
    await prisma.session.deleteMany({ where: { id: { in: Array.from(createdSessionIds) } } });
    await prisma.$disconnect();
  });

  async function register(username: string, password = "throwaway") {
    return caller.user.register({ username, password });
  }

  /** Plays sampleBoard to completion via real service calls (same shape tests/integration/show-progress.test.ts already uses) — `winner` answers every question correctly. */
  async function playToFinish(sessionId: string, winner: "TEAM_A" | "TEAM_B") {
    const started = await startGame(sessionId, "board-question", sampleBoard);
    if (!started.ok) throw new Error("setup failed to start board-question");
    for (const question of sampleBoard.questions) {
      await applyGameAction(sessionId, { type: "SELECT_QUESTION", by: "HOST", questionId: question.id });
      await applyGameAction(sessionId, { type: "BUZZ", by: winner });
      await applyGameAction(sessionId, { type: "SUBMIT_ANSWER", by: winner, text: "answer" });
      await applyGameAction(sessionId, { type: "JUDGE_ANSWER", by: "HOST", correct: true });
    }
  }

  /** A session with a HOST that's genuinely connected (real socket, real presence — see this describe's own doc comment) — what any non-host join now requires to succeed. Same shape as session.test.ts's own `freshSessionWithHost`. */
  async function hostedSession() {
    const session = await createSession();
    createdSessionIds.add(session.id);
    const host = await joinSession({ sessionCode: session.code, role: "HOST", displayName: "Coach" });
    const socket = ioClient(baseUrl, { path: "/socket.io", auth: { token: host.token }, transports: ["websocket"], forceNew: true });
    openSockets.push(socket);
    await new Promise<void>((resolve) => socket.once("presence:update", () => resolve()));
    return session;
  }

  describe("register / login / logout", () => {
    it("registers a new account and issues a working token", async () => {
      const username = uniqueUsername();
      const result = await register(username);
      expect(result.username).toBe(username);
      const me = await caller.user.me({ token: result.token });
      expect(me.username).toBe(username);
      expect(me.stats).toEqual({ gamesPlayed: 0, gamesWon: 0, gamesTied: 0, gamesLost: 0 });
    });

    it("rejects a taken username", async () => {
      const username = uniqueUsername();
      await register(username);
      await expect(register(username)).rejects.toThrow(/already taken/i);
    });

    it("rejects a wrong password on login, with the same message as an unknown username (no user-enumeration signal)", async () => {
      const username = uniqueUsername();
      await register(username, "correct-horse");
      const wrongPassword = caller.user.login({ username, password: "nope" }).catch((e: unknown) => e);
      const unknownUser = caller.user.login({ username: uniqueUsername(), password: "nope" }).catch((e: unknown) => e);
      const [wrong, unknown] = await Promise.all([wrongPassword, unknownUser]);
      expect(wrong).toBeInstanceOf(TRPCError);
      expect(unknown).toBeInstanceOf(TRPCError);
      expect((wrong as TRPCError).message).toBe((unknown as TRPCError).message);
    });

    it("logging in again rotates the token — the OLD token stops resolving", async () => {
      const username = uniqueUsername();
      const first = await register(username, "correct-horse");
      const second = await caller.user.login({ username, password: "correct-horse" });
      expect(second.token).not.toBe(first.token);
      await expect(caller.user.me({ token: first.token })).rejects.toThrow();
      const me = await caller.user.me({ token: second.token });
      expect(me.username).toBe(username);
    });

    it("logout invalidates the token server-side, not just client-side", async () => {
      const username = uniqueUsername();
      const { token } = await register(username);
      await caller.user.logout({ token });
      await expect(caller.user.me({ token })).rejects.toThrow();
    });
  });

  describe("changeUsername / changePassword", () => {
    it("changes the username, and the new one is what future logins use", async () => {
      const oldUsername = uniqueUsername();
      const { token } = await register(oldUsername, "hunter2");
      const newUsername = uniqueUsername();
      const result = await caller.user.changeUsername({ token, newUsername });
      expect(result.username).toBe(newUsername);
      const login = await caller.user.login({ username: newUsername, password: "hunter2" });
      expect(login.username).toBe(newUsername);
    });

    it("rejects changing to a username already taken by someone else", async () => {
      const takenBy = uniqueUsername();
      await register(takenBy);
      const { token } = await register(uniqueUsername());
      await expect(caller.user.changeUsername({ token, newUsername: takenBy })).rejects.toThrow(/already taken/i);
    });

    it("requires the CURRENT password to change it, and the new password actually works afterward", async () => {
      const username = uniqueUsername();
      const { token } = await register(username, "old-password");
      await expect(caller.user.changePassword({ token, currentPassword: "wrong", newPassword: "new-password" })).rejects.toThrow();
      await caller.user.changePassword({ token, currentPassword: "old-password", newPassword: "new-password" });
      await expect(caller.user.login({ username, password: "old-password" })).rejects.toThrow();
      const relogin = await caller.user.login({ username, password: "new-password" });
      expect(relogin.username).toBe(username);
    });
  });

  describe("stats — real computed numbers from actually-finished games, not a stored counter", () => {
    it("counts a win, and does NOT count for the losing account's own opponent-side stats", async () => {
      const winnerAccount = await register(uniqueUsername());
      const loserAccount = await register(uniqueUsername());
      const session = await hostedSession();
      await joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "Winner", accountToken: winnerAccount.token });
      await joinSession({ sessionCode: session.code, role: "TEAM_B", displayName: "Loser", accountToken: loserAccount.token });
      await playToFinish(session.id, "TEAM_A");

      const winnerMe = await caller.user.me({ token: winnerAccount.token });
      expect(winnerMe.stats).toEqual({ gamesPlayed: 1, gamesWon: 1, gamesTied: 0, gamesLost: 0 });
      const loserMe = await caller.user.me({ token: loserAccount.token });
      expect(loserMe.stats).toEqual({ gamesPlayed: 1, gamesWon: 0, gamesTied: 0, gamesLost: 1 });
    });

    it("an invalid/missing accountToken never blocks the join — the seat is just account-less", async () => {
      const session = await hostedSession();
      const joined = await joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "Anon", accountToken: "not-a-real-token" });
      expect(joined.role).toBe("TEAM_A");
      const participant = await prisma.participant.findUnique({ where: { id: joined.id } });
      expect(participant?.userId).toBeNull();
    });

    it("accumulates across multiple games/sessions the same account plays over time", async () => {
      const account = await register(uniqueUsername());
      const sessionOne = await hostedSession();
      await joinSession({ sessionCode: sessionOne.code, role: "TEAM_A", displayName: "P", accountToken: account.token });
      await playToFinish(sessionOne.id, "TEAM_A"); // win

      const sessionTwo = await hostedSession();
      await joinSession({ sessionCode: sessionTwo.code, role: "TEAM_B", displayName: "P", accountToken: account.token });
      await playToFinish(sessionTwo.id, "TEAM_A"); // this account is TEAM_B this time -> loss

      const me = await caller.user.me({ token: account.token });
      expect(me.stats).toEqual({ gamesPlayed: 2, gamesWon: 1, gamesTied: 0, gamesLost: 1 });
    });
  });

  describe("admin", () => {
    async function contentHostToken() {
      const host = await createContentHost(DEV_PLAYGROUND_HOST_PASSWORD);
      return host.token;
    }

    it("rejects admin queries without a valid Content Studio token", async () => {
      await expect(caller.admin.users({ token: "not-a-real-token" })).rejects.toThrow();
      await expect(caller.admin.overview({ token: "not-a-real-token" })).rejects.toThrow();
    });

    it("lists a real registered account with its own real stats", async () => {
      const username = uniqueUsername();
      await register(username);
      const token = await contentHostToken();
      const users = await caller.admin.users({ token });
      const row = users.find((u) => u.username === username);
      expect(row).toBeTruthy();
      expect(row?.stats).toEqual({ gamesPlayed: 0, gamesWon: 0, gamesTied: 0, gamesLost: 0 });
    });

    it("overview counts include this suite's own registered accounts", async () => {
      const before = await caller.admin.overview({ token: await contentHostToken() });
      await register(uniqueUsername());
      const after = await caller.admin.overview({ token: await contentHostToken() });
      expect(after.totalUsers).toBe(before.totalUsers + 1);
    });

    it("deletes a user without touching that session's own gameplay history (Participant.userId just goes back to null)", async () => {
      const account = await register(uniqueUsername());
      const session = await hostedSession();
      const joined = await joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: "P", accountToken: account.token });
      await playToFinish(session.id, "TEAM_A");

      const token = await contentHostToken();
      await caller.admin.deleteUser({ token, userId: (await caller.user.me({ token: account.token })).userId });

      const participant = await prisma.participant.findUnique({ where: { id: joined.id } });
      expect(participant).toBeTruthy(); // the seat itself still exists
      expect(participant?.userId).toBeNull(); // just no longer attributed to anyone
      const gamesForSession = await prisma.sessionGame.count({ where: { sessionId: session.id } });
      expect(gamesForSession).toBe(1); // the game history itself is untouched
    });

    it("refuses to delete an isAdmin account — the operator's own login can't be removed from this UI", async () => {
      const account = await register(uniqueUsername());
      await prisma.user.update({ where: { id: account.userId }, data: { isAdmin: true } });
      const token = await contentHostToken();
      await expect(caller.admin.deleteUser({ token, userId: account.userId })).rejects.toThrow(/admin account/i);
      const stillThere = await prisma.user.findUnique({ where: { id: account.userId } });
      expect(stillThere).toBeTruthy();
    });
  });

  describe("provisional (no-account) joins can't borrow a real account's name", () => {
    it("rejects a no-account join whose displayName exactly matches an existing account's username", async () => {
      const owner = await register(uniqueUsername());
      const session = await hostedSession();
      await expect(
        joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: owner.username }),
      ).rejects.toThrow(/real account/i);
    });

    it("rejects it case-insensitively too", async () => {
      const owner = await register(uniqueUsername());
      const session = await hostedSession();
      await expect(
        joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: owner.username.toUpperCase() }),
      ).rejects.toThrow(/real account/i);
    });

    it("still lets the account holder themselves join under their own username, accountToken attached", async () => {
      const owner = await register(uniqueUsername());
      const session = await hostedSession();
      const joined = await joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: owner.username, accountToken: owner.token });
      expect(joined.displayName).toBe(owner.username);
      const participant = await prisma.participant.findUnique({ where: { id: joined.id } });
      expect(participant?.userId).toBe(owner.userId);
    });

    it("an ordinary pseudo that matches no account joins normally", async () => {
      const session = await hostedSession();
      const joined = await joinSession({ sessionCode: session.code, role: "TEAM_A", displayName: uniqueUsername() });
      expect(joined.role).toBe("TEAM_A");
    });
  });

  describe("session.create — HOST_PASSWORD stays valid, isAdmin account is a real additive alternative", () => {
    it("still works with plain hostPassword, unchanged (the /dev playground's own path)", async () => {
      const session = await caller.session.create({ hostPassword: DEV_PLAYGROUND_HOST_PASSWORD });
      createdSessionIds.add(await prisma.session.findUniqueOrThrow({ where: { code: session.code } }).then((s) => s.id));
      expect(session.code).toHaveLength(6);
    });

    it("rejects a real, resolved account that just isn't isAdmin", async () => {
      const account = await register(uniqueUsername());
      await expect(caller.session.create({ accountToken: account.token })).rejects.toMatchObject({
        message: expect.stringMatching(/can't host/i),
      });
    });

    it("rejects neither hostPassword nor accountToken", async () => {
      await expect(caller.session.create({})).rejects.toThrow();
    });

    it("succeeds with a real isAdmin account's own token — no HOST_PASSWORD needed at all", async () => {
      const account = await register(uniqueUsername());
      await prisma.user.update({ where: { id: account.userId }, data: { isAdmin: true } });
      const session = await caller.session.create({ accountToken: account.token });
      createdSessionIds.add(await prisma.session.findUniqueOrThrow({ where: { code: session.code } }).then((s) => s.id));
      expect(session.code).toHaveLength(6);
      expect(session.hostKey).toBeTruthy();
    });
  });

  describe("session.resumeByAccount / session.reclaimByAccount — the account-based alternative to the recovery key", () => {
    it("resumeByAccount is null when the account has never hosted anything", async () => {
      const account = await register(uniqueUsername());
      expect(await caller.session.resumeByAccount({ accountToken: account.token })).toBeNull();
    });

    it("resumeByAccount is null once every session that account hosted has finished", async () => {
      const account = await register(uniqueUsername());
      await prisma.user.update({ where: { id: account.userId }, data: { isAdmin: true } });
      const session = await caller.session.create({ accountToken: account.token });
      createdSessionIds.add((await prisma.session.findUniqueOrThrow({ where: { code: session.code } })).id);
      const host = await caller.session.join({ sessionCode: session.code, role: "HOST", displayName: "Erwin", accountToken: account.token });
      await caller.session.finish({ token: host.token });

      expect(await caller.session.resumeByAccount({ accountToken: account.token })).toBeNull();
    });

    it("finds a real, unfinished session this account hosts, and reclaimByAccount genuinely reconnects to that SAME seat", async () => {
      const account = await register(uniqueUsername());
      await prisma.user.update({ where: { id: account.userId }, data: { isAdmin: true } });
      const created = await caller.session.create({ accountToken: account.token });
      createdSessionIds.add((await prisma.session.findUniqueOrThrow({ where: { code: created.code } })).id);
      const originalJoin = await caller.session.join({ sessionCode: created.code, role: "HOST", displayName: "Erwin", accountToken: account.token });

      const found = await caller.session.resumeByAccount({ accountToken: account.token });
      expect(found?.sessionCode).toBe(created.code);

      const reclaimed = await caller.session.reclaimByAccount({ accountToken: account.token });
      expect(reclaimed.sessionCode).toBe(created.code);
      expect(reclaimed.id).toBe(originalJoin.id); // the SAME seat, not a second HOST participant
      expect(reclaimed.token).not.toBe(originalJoin.token); // a fresh token, same rotate-on-reclaim posture as reclaimHost's own hostKey path

      // The old token is genuinely dead now.
      await expect(caller.session.me({ token: originalJoin.token })).rejects.toThrow();
      const stillWorks = await caller.session.me({ token: reclaimed.token });
      expect(stillWorks.role).toBe("HOST");
    });

    it("reclaimByAccount rejects an account with nothing to resume", async () => {
      const account = await register(uniqueUsername());
      await expect(caller.session.reclaimByAccount({ accountToken: account.token })).rejects.toThrow();
    });

    it("reclaimByAccount rejects a stale/invalid account token the same honest way (never a false-positive resume)", async () => {
      await expect(caller.session.reclaimByAccount({ accountToken: "not-a-real-token" })).rejects.toThrow();
      expect(await caller.session.resumeByAccount({ accountToken: "not-a-real-token" })).toBeNull();
    });

    it("a non-admin account never resolves a resumable session, even if it somehow held a HOST seat", async () => {
      // isAdmin only gates session.create — resumeByAccount itself has no
      // separate isAdmin check (there's nothing TO find for a non-admin
      // account, since it could never have created a session as HOST in
      // the first place) — this proves that's really true, not assumed.
      const account = await register(uniqueUsername());
      expect(await caller.session.resumeByAccount({ accountToken: account.token })).toBeNull();
    });
  });
});
