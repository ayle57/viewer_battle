import { beforeEach, describe, expect, it } from "vitest";
import { useGameStore } from "./gameStore";

/**
 * Plain vitest, no DOM/React — a Zustand store is just a JS object with
 * getState/setState, testable directly (same posture as this project's
 * other pure-logic unit tests). Fits the existing architecture; no new
 * testing dependency needed for this.
 *
 * The real bug this file exists to lock down: `sessionEnded`/`kicked`
 * used to be documented "never reset — a genuinely new session means a
 * fresh page/token/store anyway," which stopped being true the moment
 * this store got pinned to `globalThis` for Fast Refresh safety (this
 * file's own doc comment) — "Start a new game" after a session ended is
 * now a pure client-side identity swap with NO page reload, so a stale
 * `sessionEnded: true` from the OLD session silently carried over and
 * permanently pinned the BRAND NEW session to the same terminal screen.
 * Confirmed via a real live-server, real-browser-identity repro before
 * the fix; this test is the permanent, automated guard against it
 * regressing.
 */
describe("gameStore.reset()", () => {
  beforeEach(() => {
    useGameStore.getState().reset();
  });

  it("clears sessionEnded back to false — the exact bug this exists to prevent regressing", () => {
    useGameStore.getState().setSessionEnded();
    expect(useGameStore.getState().sessionEnded).toBe(true);

    useGameStore.getState().reset();
    expect(useGameStore.getState().sessionEnded).toBe(false);
  });

  it("clears kicked back to false, same contract as sessionEnded", () => {
    useGameStore.getState().setKicked();
    expect(useGameStore.getState().kicked).toBe(true);

    useGameStore.getState().reset();
    expect(useGameStore.getState().kicked).toBe(false);
  });

  it("clears synced back to false — a fresh identity must re-earn its own catch-up confirmation, not inherit the previous one's", () => {
    useGameStore.getState().setSynced();
    expect(useGameStore.getState().synced).toBe(true);

    useGameStore.getState().reset();
    expect(useGameStore.getState().synced).toBe(false);
  });

  it("clears the previous game's snapshot/status/error — a fresh identity must never show a stale board or a stale connection error", () => {
    useGameStore.getState().setSnapshot({ gameId: "g1", gameKey: "geoguessr", state: { foo: "bar" }, events: [{ type: "X" }] });
    useGameStore.getState().setStatus("connected");
    useGameStore.getState().setError({ code: "OOPS", message: "something broke" });

    useGameStore.getState().reset();

    const state = useGameStore.getState();
    expect(state.gameId).toBeNull();
    expect(state.gameKey).toBeNull();
    expect(state.gameState).toBeNull();
    expect(state.lastEvents).toEqual([]);
    expect(state.status).toBe("connecting");
    expect(state.lastError).toBeNull();
  });

  it("reset() is exactly the initial state — not an approximation of it", () => {
    useGameStore.getState().setSessionEnded();
    useGameStore.getState().setKicked();
    useGameStore.getState().setSynced();
    useGameStore.getState().setSnapshot({ gameId: "g1", gameKey: "board-question", state: {}, events: [] });
    useGameStore.getState().setStatus("unauthorized");
    useGameStore.getState().setError({ code: "E", message: "e" });

    useGameStore.getState().reset();

    const { setSnapshot, setStatus, setError, setSessionEnded, setKicked, setSynced, reset, ...dataFields } = useGameStore.getState();
    void setSnapshot;
    void setStatus;
    void setError;
    void setSessionEnded;
    void setKicked;
    void setSynced;
    void reset;
    expect(dataFields).toEqual({
      gameId: null,
      gameKey: null,
      gameState: null,
      status: "connecting",
      lastEvents: [],
      lastError: null,
      sessionEnded: false,
      kicked: false,
      synced: false,
    });
  });
});
