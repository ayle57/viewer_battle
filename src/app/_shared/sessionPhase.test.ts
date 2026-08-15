import { describe, expect, it } from "vitest";
import { deriveSessionPhase, readGameStatus } from "./sessionPhase";

describe("deriveSessionPhase", () => {
  it("SESSION_LOBBY before any game has ever been started", () => {
    expect(deriveSessionPhase({ sessionStatus: "ACTIVE", gameId: null, gameStatus: null })).toBe("SESSION_LOBBY");
  });

  it("SESSION_LOBBY even while the session is still CREATED (host hasn't joined the socket yet)", () => {
    expect(deriveSessionPhase({ sessionStatus: "CREATED", gameId: null, gameStatus: null })).toBe("SESSION_LOBBY");
  });

  it("GAME_IN_PROGRESS once a game exists and isn't finished", () => {
    expect(deriveSessionPhase({ sessionStatus: "ACTIVE", gameId: "g1", gameStatus: "in_progress" })).toBe(
      "GAME_IN_PROGRESS",
    );
  });

  it("GAME_FINISHED once the current game's status flips to finished", () => {
    expect(deriveSessionPhase({ sessionStatus: "ACTIVE", gameId: "g1", gameStatus: "finished" })).toBe(
      "GAME_FINISHED",
    );
  });

  it("SESSION_FINISHED once the session itself is finished, regardless of the last game's status", () => {
    expect(deriveSessionPhase({ sessionStatus: "FINISHED", gameId: "g1", gameStatus: "in_progress" })).toBe(
      "SESSION_FINISHED",
    );
    expect(deriveSessionPhase({ sessionStatus: "FINISHED", gameId: "g1", gameStatus: "finished" })).toBe(
      "SESSION_FINISHED",
    );
    expect(deriveSessionPhase({ sessionStatus: "FINISHED", gameId: null, gameStatus: null })).toBe(
      "SESSION_FINISHED",
    );
  });

  it("a fresh next game (new gameId, status back to in_progress) reads as GAME_IN_PROGRESS again, not stuck on GAME_FINISHED", () => {
    const afterFirstGame = deriveSessionPhase({ sessionStatus: "ACTIVE", gameId: "g1", gameStatus: "finished" });
    expect(afterFirstGame).toBe("GAME_FINISHED");
    const afterSecondGameStarts = deriveSessionPhase({ sessionStatus: "ACTIVE", gameId: "g2", gameStatus: "in_progress" });
    expect(afterSecondGameStarts).toBe("GAME_IN_PROGRESS");
  });

  it("sessionStatus not resolved yet (query still loading) doesn't crash and falls through to the game signals", () => {
    expect(deriveSessionPhase({ sessionStatus: undefined, gameId: null, gameStatus: null })).toBe("SESSION_LOBBY");
    expect(deriveSessionPhase({ sessionStatus: undefined, gameId: "g1", gameStatus: "in_progress" })).toBe(
      "GAME_IN_PROGRESS",
    );
  });
});

describe("readGameStatus", () => {
  it("reads a valid GameStatus off any opaque snapshot", () => {
    expect(readGameStatus({ status: "in_progress", anything: "else" })).toBe("in_progress");
    expect(readGameStatus({ status: "finished" })).toBe("finished");
  });

  it("returns null for no snapshot, or a snapshot with no recognizable status", () => {
    expect(readGameStatus(null)).toBeNull();
    expect(readGameStatus({})).toBeNull();
    expect(readGameStatus({ status: "not-a-real-status" })).toBeNull();
  });
});
