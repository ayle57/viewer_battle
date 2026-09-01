import { describe, expect, it } from "vitest";
import { getSteamRatingsPlaylistReadiness, isGameComplete } from "./steamReadiness";

describe("isGameComplete", () => {
  it("true only when title, imageUrl, and at least one rating are all present", () => {
    expect(isGameComplete({ title: "X", imageUrl: "/images/steam/x.png", ratings: ["a"] })).toBe(true);
    expect(isGameComplete({ title: null, imageUrl: "/images/steam/x.png", ratings: ["a"] })).toBe(false);
    expect(isGameComplete({ title: "X", imageUrl: null, ratings: ["a"] })).toBe(false);
    expect(isGameComplete({ title: "X", imageUrl: "/images/steam/x.png", ratings: [] })).toBe(false);
    expect(isGameComplete({ title: null, imageUrl: null, ratings: [] })).toBe(false);
  });
});

describe("getSteamRatingsPlaylistReadiness", () => {
  it("empty when there are no games at all", () => {
    const readiness = getSteamRatingsPlaylistReadiness([]);
    expect(readiness.status).toBe("empty");
    expect(readiness.ready).toBe(false);
    expect(readiness.summary).toBe("Add a game to get started.");
  });

  it("incomplete when a game exists but is missing title, image, or ratings", () => {
    const readiness = getSteamRatingsPlaylistReadiness([{ id: "g1", title: null, imageUrl: "/images/steam/x.png", ratings: [] }]);
    expect(readiness.status).toBe("incomplete");
    expect(readiness.ready).toBe(false);
    expect(readiness.incompleteGames).toEqual([{ gameId: "g1", missingTitle: true, missingImage: false, missingRatings: true }]);
    expect(readiness.firstProblemGameId).toBe("g1");
  });

  it("ready once every game has a title, an image, and at least one rating", () => {
    const readiness = getSteamRatingsPlaylistReadiness([
      { id: "g1", title: "Game A", imageUrl: "/images/steam/a.png", ratings: ["nice"] },
      { id: "g2", title: "Game B", imageUrl: "/images/steam/b.png", ratings: ["cool", "great"] },
    ]);
    expect(readiness.status).toBe("ready");
    expect(readiness.ready).toBe(true);
    expect(readiness.completeGameCount).toBe(2);
    expect(readiness.incompleteGames).toEqual([]);
    expect(readiness.firstProblemGameId).toBeNull();
    expect(readiness.summary).toBe("Ready to play.");
  });

  it("counts complete/incomplete independently across a mixed list", () => {
    const readiness = getSteamRatingsPlaylistReadiness([
      { id: "g1", title: "Game A", imageUrl: "/images/steam/a.png", ratings: ["x"] },
      { id: "g2", title: null, imageUrl: null, ratings: [] },
      { id: "g3", title: "Game C", imageUrl: null, ratings: ["x"] },
      { id: "g4", title: "Game D", imageUrl: "/images/steam/d.png", ratings: ["x"] },
    ]);
    expect(readiness.gameCount).toBe(4);
    expect(readiness.completeGameCount).toBe(2);
    expect(readiness.incompleteGames).toEqual([
      { gameId: "g2", missingTitle: true, missingImage: true, missingRatings: true },
      { gameId: "g3", missingTitle: false, missingImage: true, missingRatings: false },
    ]);
    expect(readiness.firstProblemGameId).toBe("g2");
    expect(readiness.summary).toBe("2 games are missing a title, cover, or at least one rating.");
  });
});
