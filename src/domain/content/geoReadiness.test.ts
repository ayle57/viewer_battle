import { describe, expect, it } from "vitest";
import { getGeoPlaylistReadiness, isRoundComplete } from "./geoReadiness";

describe("isRoundComplete", () => {
  it("true only when image, question, AND target are all present", () => {
    expect(isRoundComplete({ imageUrl: "/x.jpg", question: "Where?", targetX: 0.5, targetY: 0.5 })).toBe(true);
    expect(isRoundComplete({ imageUrl: null, question: "Where?", targetX: 0.5, targetY: 0.5 })).toBe(false);
    expect(isRoundComplete({ imageUrl: "/x.jpg", question: null, targetX: 0.5, targetY: 0.5 })).toBe(false);
    expect(isRoundComplete({ imageUrl: "/x.jpg", question: "Where?", targetX: null, targetY: 0.5 })).toBe(false);
    expect(isRoundComplete({ imageUrl: "/x.jpg", question: "Where?", targetX: 0.5, targetY: null })).toBe(false);
    expect(isRoundComplete({ imageUrl: null, question: null, targetX: null, targetY: null })).toBe(false);
  });
});

describe("getGeoPlaylistReadiness", () => {
  it("empty when there are no rounds at all", () => {
    const readiness = getGeoPlaylistReadiness([]);
    expect(readiness.status).toBe("empty");
    expect(readiness.ready).toBe(false);
    expect(readiness.summary).toBe("Add a round to get started.");
  });

  it("incomplete when a round exists but is missing image/question/target", () => {
    const readiness = getGeoPlaylistReadiness([
      { id: "r1", title: null, imageUrl: null, question: null, targetX: null, targetY: null },
    ]);
    expect(readiness.status).toBe("incomplete");
    expect(readiness.ready).toBe(false);
    expect(readiness.incompleteRounds).toEqual([
      { roundId: "r1", missingImage: true, missingQuestion: true, missingTarget: true },
    ]);
    expect(readiness.firstProblemRoundId).toBe("r1");
  });

  it("flags a round missing only its question, independently of image/target", () => {
    const readiness = getGeoPlaylistReadiness([
      { id: "r1", title: null, imageUrl: "/x.jpg", question: null, targetX: 0.5, targetY: 0.5 },
    ]);
    expect(readiness.incompleteRounds).toEqual([
      { roundId: "r1", missingImage: false, missingQuestion: true, missingTarget: false },
    ]);
  });

  it("flags a round with an image but no target, and vice versa, independently", () => {
    const readiness = getGeoPlaylistReadiness([
      { id: "r1", title: null, imageUrl: "/x.jpg", question: "Where?", targetX: null, targetY: null },
      { id: "r2", title: null, imageUrl: null, question: "Where?", targetX: 0.5, targetY: 0.5 },
    ]);
    expect(readiness.incompleteRounds).toEqual([
      { roundId: "r1", missingImage: false, missingQuestion: false, missingTarget: true },
      { roundId: "r2", missingImage: true, missingQuestion: false, missingTarget: false },
    ]);
  });

  it("ready once every round has an image, a question, and a target", () => {
    const readiness = getGeoPlaylistReadiness([
      { id: "r1", title: null, imageUrl: "/x.jpg", question: "Where is spot 1?", targetX: 0.1, targetY: 0.2 },
      { id: "r2", title: null, imageUrl: "/y.jpg", question: "Where is spot 2?", targetX: 0.3, targetY: 0.4 },
    ]);
    expect(readiness.status).toBe("ready");
    expect(readiness.ready).toBe(true);
    expect(readiness.completeRoundCount).toBe(2);
    expect(readiness.roundCount).toBe(2);
    expect(readiness.firstProblemRoundId).toBeNull();
    expect(readiness.summary).toBe("Ready to play.");
  });

  it("does not require any specific round count beyond at least one complete round", () => {
    const readiness = getGeoPlaylistReadiness([
      { id: "r1", title: null, imageUrl: "/x.jpg", question: "Where?", targetX: 0.5, targetY: 0.5 },
    ]);
    expect(readiness.ready).toBe(true); // a single complete round is enough — see this file's top comment
  });

  it("summary counts incomplete rounds, singular vs. plural", () => {
    const one = getGeoPlaylistReadiness([
      { id: "r1", title: null, imageUrl: null, question: null, targetX: null, targetY: null },
    ]);
    expect(one.summary).toBe("1 round is missing an image, question, or target.");
    const two = getGeoPlaylistReadiness([
      { id: "r1", title: null, imageUrl: null, question: null, targetX: null, targetY: null },
      { id: "r2", title: null, imageUrl: null, question: null, targetX: null, targetY: null },
    ]);
    expect(two.summary).toBe("2 rounds are missing an image, question, or target.");
  });
});
