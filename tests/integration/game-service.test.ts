import { afterAll, describe, expect, it } from "vitest";
import { createSession } from "@/server/db/session";
import { joinSession } from "@/server/db/participant";
import { applyGameAction, getCurrentGame, startGame } from "@/server/game";
import { sampleBoard } from "@/domain/game/boardQuestion";
import { prisma } from "@/server/db/client";

/**
 * Direct calls to the bridge (src/server/game/service.ts) — the exact
 * functions the tRPC `game.start` mutation and the `game:action` socket
 * handler call. No HTTP, no sockets: this is "the Kernel through real
 * Prisma," the socket transport gets its own coverage in
 * tests/integration/game-socket.test.ts.
 */
describe("Game service (Prisma <-> Game Kernel bridge)", () => {
  const createdSessionIds = new Set<string>();

  afterAll(async () => {
    await prisma.session.deleteMany({ where: { id: { in: Array.from(createdSessionIds) } } });
    await prisma.$disconnect();
  });

  async function freshSessionId() {
    const session = await createSession();
    createdSessionIds.add(session.id);
    return session.id;
  }

  it("creates a SessionGame row with the engine's initial state", async () => {
    const sessionId = await freshSessionId();
    const result = await startGame(sessionId, "board-question", sampleBoard);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const row = await prisma.sessionGame.findUniqueOrThrow({ where: { id: result.gameId } });
    expect(row.gameKey).toBe("board-question");
    expect(row.status).toBe("IN_PROGRESS");
    expect(row.version).toBe(0);
  });

  it("refuses to start a second game while one is in progress", async () => {
    const sessionId = await freshSessionId();
    await startGame(sessionId, "board-question", sampleBoard);
    const second = await startGame(sessionId, "board-question", sampleBoard);
    expect(second.ok).toBe(false);
    expect(!second.ok && second.error.code).toBe("GAME_IN_PROGRESS");
  });

  it("getCurrentGame loads the most recently started game", async () => {
    const sessionId = await freshSessionId();
    await startGame(sessionId, "board-question", sampleBoard);
    const game = await getCurrentGame(sessionId);
    expect(game?.gameKey).toBe("board-question");
  });

  it("applies a valid action and persists the resulting state", async () => {
    const sessionId = await freshSessionId();
    const started = await startGame(sessionId, "board-question", sampleBoard);
    if (!started.ok) throw new Error("setup failed");

    const result = await applyGameAction(sessionId, {
      type: "SELECT_QUESTION",
      by: "HOST",
      questionId: "q-geo-100",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.state as { phase: string }).phase).toBe("revealed");

    const row = await prisma.sessionGame.findUniqueOrThrow({ where: { id: started.gameId } });
    expect((row.internalState as { phase: string }).phase).toBe("revealed");
    expect(row.version).toBe(1);
  });

  it("full round trip: select, buzz, judge correct -> score updated and persisted", async () => {
    const sessionId = await freshSessionId();
    await startGame(sessionId, "board-question", sampleBoard);
    await applyGameAction(sessionId, { type: "SELECT_QUESTION", by: "HOST", questionId: "q-geo-100" });
    await applyGameAction(sessionId, { type: "BUZZ", by: "TEAM_A" });
    await applyGameAction(sessionId, { type: "SUBMIT_ANSWER", by: "TEAM_A", text: "answer" });
    const judged = await applyGameAction(sessionId, { type: "JUDGE_ANSWER", by: "HOST", correct: true });

    expect(judged.ok).toBe(true);
    if (!judged.ok) return;
    const scores = (judged.state as { scores: { TEAM_A: number; TEAM_B: number } }).scores;
    expect(scores.TEAM_A).toBe(100);

    const game = await getCurrentGame(sessionId);
    expect((game?.internalState as { scores: { TEAM_A: number } }).scores.TEAM_A).toBe(100);
  });

  it("rejects an already-played question via the bridge, same as the kernel", async () => {
    const sessionId = await freshSessionId();
    await startGame(sessionId, "board-question", sampleBoard);
    await applyGameAction(sessionId, { type: "SELECT_QUESTION", by: "HOST", questionId: "q-geo-100" });
    await applyGameAction(sessionId, { type: "BUZZ", by: "TEAM_A" });
    await applyGameAction(sessionId, { type: "SUBMIT_ANSWER", by: "TEAM_A", text: "answer" });
    await applyGameAction(sessionId, { type: "JUDGE_ANSWER", by: "HOST", correct: true });

    const result = await applyGameAction(sessionId, { type: "SELECT_QUESTION", by: "HOST", questionId: "q-geo-100" });
    expect(!result.ok && result.error.code).toBe("QUESTION_ALREADY_PLAYED");
  });

  it("rejects any action once the game has finished", async () => {
    const sessionId = await freshSessionId();
    await startGame(sessionId, "board-question", sampleBoard);
    for (const question of sampleBoard.questions) {
      await applyGameAction(sessionId, { type: "SELECT_QUESTION", by: "HOST", questionId: question.id });
      await applyGameAction(sessionId, { type: "BUZZ", by: "TEAM_A" });
      await applyGameAction(sessionId, { type: "SUBMIT_ANSWER", by: "TEAM_A", text: "answer" });
      await applyGameAction(sessionId, { type: "JUDGE_ANSWER", by: "HOST", correct: true });
    }

    const game = await getCurrentGame(sessionId);
    expect(game?.status).toBe("FINISHED");

    const result = await applyGameAction(sessionId, { type: "SELECT_QUESTION", by: "HOST", questionId: "q-geo-100" });
    expect(!result.ok && result.error.code).toBe("GAME_ALREADY_FINISHED");
  });

  it("rejects acting on a session with no game running", async () => {
    const sessionId = await freshSessionId();
    const result = await applyGameAction(sessionId, { type: "SELECT_QUESTION", by: "HOST", questionId: "q-geo-100" });
    expect(!result.ok && result.error.code).toBe("GAME_NOT_FOUND");
  });

  it("keeps the real Participant join flow working alongside a game (sanity check, not duplicating session.test.ts)", async () => {
    const session = await createSession();
    createdSessionIds.add(session.id);
    const host = await joinSession({ sessionCode: session.code, role: "HOST", displayName: "Alex" });
    expect(host.role).toBe("HOST");
  });

  describe("concurrency", () => {
    it("two simultaneous BUZZ actions from both teams: exactly one wins, state never corrupts", async () => {
      const sessionId = await freshSessionId();
      await startGame(sessionId, "board-question", sampleBoard);
      await applyGameAction(sessionId, { type: "SELECT_QUESTION", by: "HOST", questionId: "q-geo-100" });

      const [a, b] = await Promise.all([
        applyGameAction(sessionId, { type: "BUZZ", by: "TEAM_A" }),
        applyGameAction(sessionId, { type: "BUZZ", by: "TEAM_B" }),
      ]);

      const results = [a, b];
      const succeeded = results.filter((r) => r.ok);
      const failed = results.filter((r) => !r.ok);
      // Exactly one BUZZ wins the phase transition to "answering"; the
      // other legitimately fails with WRONG_PHASE (it re-read the fresh,
      // already-"answering" state on retry — see service.ts's optimistic
      // retry loop — so this is a real rejection reason, not a generic
      // conflict error).
      expect(succeeded).toHaveLength(1);
      expect(failed).toHaveLength(1);
      expect(failed[0] && !failed[0].ok && failed[0].error.code).toBe("WRONG_PHASE");

      const game = await getCurrentGame(sessionId);
      const state = game?.internalState as { phase: string; buzzedTeam: string | null };
      expect(state.phase).toBe("answering");
      expect(["TEAM_A", "TEAM_B"]).toContain(state.buzzedTeam);
      // 2 successful writes total for this test: SELECT_QUESTION (0->1)
      // then exactly one of the two racing BUZZes (1->2) — the losing
      // BUZZ is rejected by the engine on retry, not written at all.
      expect(game?.version).toBe(2);
    });
  });
});
