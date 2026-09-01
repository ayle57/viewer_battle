import { describe, expect, it } from "vitest";
import { getMusicPlaylistReadiness, isTrackComplete } from "./musicReadiness";

describe("isTrackComplete", () => {
  it("true only when both audioUrl and title are present", () => {
    expect(isTrackComplete({ audioUrl: "/audio/music/x.wav", title: "X" })).toBe(true);
    expect(isTrackComplete({ audioUrl: null, title: "X" })).toBe(false);
    expect(isTrackComplete({ audioUrl: "/audio/music/x.wav", title: null })).toBe(false);
    expect(isTrackComplete({ audioUrl: null, title: null })).toBe(false);
  });
});

describe("getMusicPlaylistReadiness", () => {
  it("empty when there are no tracks at all", () => {
    const readiness = getMusicPlaylistReadiness([]);
    expect(readiness.status).toBe("empty");
    expect(readiness.ready).toBe(false);
    expect(readiness.summary).toBe("Add a track to get started.");
  });

  it("incomplete when a track exists but is missing audio or title", () => {
    const readiness = getMusicPlaylistReadiness([{ id: "t1", audioUrl: null, title: "X" }]);
    expect(readiness.status).toBe("incomplete");
    expect(readiness.ready).toBe(false);
    expect(readiness.incompleteTracks).toEqual([{ trackId: "t1", missingAudio: true, missingTitle: false }]);
    expect(readiness.firstProblemTrackId).toBe("t1");
  });

  it("ready once every track has both audio and title (artist stays optional)", () => {
    const readiness = getMusicPlaylistReadiness([
      { id: "t1", audioUrl: "/audio/music/a.wav", title: "Track A" },
      { id: "t2", audioUrl: "/audio/music/b.wav", title: "Track B" },
    ]);
    expect(readiness.status).toBe("ready");
    expect(readiness.ready).toBe(true);
    expect(readiness.completeTrackCount).toBe(2);
    expect(readiness.incompleteTracks).toEqual([]);
    expect(readiness.firstProblemTrackId).toBeNull();
    expect(readiness.summary).toBe("Ready to play.");
  });

  it("counts complete/incomplete independently across a mixed list", () => {
    const readiness = getMusicPlaylistReadiness([
      { id: "t1", audioUrl: "/audio/music/a.wav", title: "Track A" },
      { id: "t2", audioUrl: null, title: null },
      { id: "t3", audioUrl: "/audio/music/c.wav", title: null },
      { id: "t4", audioUrl: "/audio/music/d.wav", title: "Track D" },
    ]);
    expect(readiness.trackCount).toBe(4);
    expect(readiness.completeTrackCount).toBe(2);
    expect(readiness.incompleteTracks).toEqual([
      { trackId: "t2", missingAudio: true, missingTitle: true },
      { trackId: "t3", missingAudio: false, missingTitle: true },
    ]);
    expect(readiness.firstProblemTrackId).toBe("t2");
    expect(readiness.summary).toBe("2 tracks are missing a clip or a title.");
  });
});
