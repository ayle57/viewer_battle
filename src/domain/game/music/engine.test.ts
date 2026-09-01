import { describe, expect, it } from "vitest";
import { apply, availableActions, createInitialState, MUSIC_WIN_THRESHOLD } from "./engine";
import { toPublicView } from "./view";
import { sampleMusicPlaylist } from "./fixtures";
import type { MusicConfig, MusicState } from "./types";

function freshState(config: MusicConfig = sampleMusicPlaylist): MusicState {
  return createInitialState(config);
}

function mustOk(result: ReturnType<typeof apply>): MusicState {
  if (!result.ok) throw new Error(`expected ok, got error ${result.error.code}: ${result.error.message}`);
  return result.state;
}

const NOW = 1_700_000_000_000;

describe("createInitialState", () => {
  it("starts in_progress, intro, zero scores, no playback, nothing played", () => {
    const state = freshState();
    expect(state.status).toBe("in_progress");
    expect(state.phase).toBe("intro");
    expect(state.currentRoundIndex).toBe(0);
    expect(state.playbackStartedAt).toBeNull();
    expect(state.broadcastVolume).toBe(1);
    expect(state.scores).toEqual({ TEAM_A: 0, TEAM_B: 0 });
    expect(state.history).toEqual([]);
    expect(state.winner).toBeNull();
  });
});

describe("START_PLAYBACK", () => {
  it("moves to guessing and anchors playbackStartedAt to the server-injected nowMs", () => {
    const result = apply(freshState(), { type: "START_PLAYBACK", by: "HOST", nowMs: NOW });
    const next = mustOk(result);
    expect(next.phase).toBe("guessing");
    expect(next.playbackStartedAt).toBe(NOW);
    expect(result.ok && result.events).toEqual([{ type: "PLAYBACK_STARTED", roundIndex: 0, startedAt: NOW }]);
  });

  it("does not mutate the input state", () => {
    const state = freshState();
    apply(state, { type: "START_PLAYBACK", by: "HOST", nowMs: NOW });
    expect(state.phase).toBe("intro");
    expect(state.playbackStartedAt).toBeNull();
  });

  it("rejects a non-host", () => {
    const result = apply(freshState(), { type: "START_PLAYBACK", by: "TEAM_A", nowMs: NOW });
    expect(!result.ok && result.error.code).toBe("FORBIDDEN_ROLE");
  });

  it("rejects DISPLAY outright", () => {
    const result = apply(freshState(), { type: "START_PLAYBACK", by: "DISPLAY", nowMs: NOW });
    expect(!result.ok && result.error.code).toBe("FORBIDDEN_ROLE");
  });

  it("rejects a second START_PLAYBACK once already past intro (use REPLAY_AUDIO instead)", () => {
    const guessing = mustOk(apply(freshState(), { type: "START_PLAYBACK", by: "HOST", nowMs: NOW }));
    const result = apply(guessing, { type: "START_PLAYBACK", by: "HOST", nowMs: NOW + 1000 });
    expect(!result.ok && result.error.code).toBe("WRONG_PHASE");
  });
});

describe("REPLAY_AUDIO", () => {
  it("rejects replaying before the round's mandatory first play", () => {
    const result = apply(freshState(), { type: "REPLAY_AUDIO", by: "HOST", nowMs: NOW });
    expect(!result.ok && result.error.code).toBe("PLAYBACK_NOT_STARTED");
  });

  it("re-anchors playbackStartedAt without touching phase/buzz/answer state", () => {
    const guessing = mustOk(apply(freshState(), { type: "START_PLAYBACK", by: "HOST", nowMs: NOW }));
    const result = apply(guessing, { type: "REPLAY_AUDIO", by: "HOST", nowMs: NOW + 5000 });
    const next = mustOk(result);
    expect(next.phase).toBe("guessing");
    expect(next.playbackStartedAt).toBe(NOW + 5000);
  });

  it("works during 'answering' too (Host replaying before judging, or before a steal)", () => {
    let state = mustOk(apply(freshState(), { type: "START_PLAYBACK", by: "HOST", nowMs: NOW }));
    state = mustOk(apply(state, { type: "BUZZ", by: "TEAM_A" }));
    const result = apply(state, { type: "REPLAY_AUDIO", by: "HOST", nowMs: NOW + 9000 });
    const next = mustOk(result);
    expect(next.phase).toBe("answering");
    expect(next.playbackStartedAt).toBe(NOW + 9000);
  });

  it("rejects a non-host", () => {
    const guessing = mustOk(apply(freshState(), { type: "START_PLAYBACK", by: "HOST", nowMs: NOW }));
    const result = apply(guessing, { type: "REPLAY_AUDIO", by: "TEAM_A", nowMs: NOW + 1 });
    expect(!result.ok && result.error.code).toBe("FORBIDDEN_ROLE");
  });

  it("clears an existing pause — a replay always resumes from 0, never stays paused", () => {
    let state = mustOk(apply(freshState(), { type: "START_PLAYBACK", by: "HOST", nowMs: NOW }));
    state = mustOk(apply(state, { type: "PAUSE_PLAYBACK", by: "HOST", nowMs: NOW + 1000 }));
    expect(state.playbackPausedAt).toBe(NOW + 1000);
    const result = apply(state, { type: "REPLAY_AUDIO", by: "HOST", nowMs: NOW + 5000 });
    const next = mustOk(result);
    expect(next.playbackStartedAt).toBe(NOW + 5000);
    expect(next.playbackPausedAt).toBeNull();
  });
});

describe("PAUSE_PLAYBACK / RESUME_PLAYBACK", () => {
  it("rejects pausing before playback has started", () => {
    const result = apply(freshState(), { type: "PAUSE_PLAYBACK", by: "HOST", nowMs: NOW });
    expect(!result.ok && result.error.code).toBe("PLAYBACK_NOT_STARTED");
  });

  it("pauses without touching phase/buzz/answer state", () => {
    let state = mustOk(apply(freshState(), { type: "START_PLAYBACK", by: "HOST", nowMs: NOW }));
    state = mustOk(apply(state, { type: "BUZZ", by: "TEAM_A" }));
    const result = apply(state, { type: "PAUSE_PLAYBACK", by: "HOST", nowMs: NOW + 3000 });
    const next = mustOk(result);
    expect(next.playbackPausedAt).toBe(NOW + 3000);
    expect(next.playbackStartedAt).toBe(NOW); // unchanged — only the pause marker moved
    expect(next.phase).toBe("answering");
    expect(next.buzzedTeam).toBe("TEAM_A");
    expect(result.ok && result.events).toEqual([{ type: "PLAYBACK_PAUSED", pausedAt: NOW + 3000 }]);
  });

  it("rejects pausing twice in a row", () => {
    let state = mustOk(apply(freshState(), { type: "START_PLAYBACK", by: "HOST", nowMs: NOW }));
    state = mustOk(apply(state, { type: "PAUSE_PLAYBACK", by: "HOST", nowMs: NOW + 1000 }));
    const result = apply(state, { type: "PAUSE_PLAYBACK", by: "HOST", nowMs: NOW + 2000 });
    expect(!result.ok && result.error.code).toBe("ALREADY_PAUSED");
  });

  it("rejects resuming when not paused", () => {
    const guessing = mustOk(apply(freshState(), { type: "START_PLAYBACK", by: "HOST", nowMs: NOW }));
    const result = apply(guessing, { type: "RESUME_PLAYBACK", by: "HOST", nowMs: NOW + 1000 });
    expect(!result.ok && result.error.code).toBe("NOT_PAUSED");
  });

  it("resuming shifts playbackStartedAt forward by exactly the paused duration, clears the pause marker", () => {
    let state = mustOk(apply(freshState(), { type: "START_PLAYBACK", by: "HOST", nowMs: NOW }));
    state = mustOk(apply(state, { type: "PAUSE_PLAYBACK", by: "HOST", nowMs: NOW + 2000 })); // paused 2s into the clip
    const result = apply(state, { type: "RESUME_PLAYBACK", by: "HOST", nowMs: NOW + 7000 }); // resumed 5s of WALL TIME later (paused for 5s)
    const next = mustOk(result);
    expect(next.playbackPausedAt).toBeNull();
    // The new anchor must satisfy (resumeAt - newStartedAt) == the frozen
    // 2s offset, so the resumed elapsed time picks up exactly where it
    // left off: (NOW+7000) - (NOW+5000) == 2000ms, matching the pause.
    expect(next.playbackStartedAt).toBe(NOW + 5000);
    expect(result.ok && result.events).toEqual([{ type: "PLAYBACK_RESUMED", startedAt: NOW + 5000 }]);
  });

  it("rejects a non-host for either action", () => {
    let state = mustOk(apply(freshState(), { type: "START_PLAYBACK", by: "HOST", nowMs: NOW }));
    expect(!apply(state, { type: "PAUSE_PLAYBACK", by: "TEAM_A", nowMs: NOW }).ok).toBe(true);
    state = mustOk(apply(state, { type: "PAUSE_PLAYBACK", by: "HOST", nowMs: NOW + 1000 }));
    expect(!apply(state, { type: "RESUME_PLAYBACK", by: "TEAM_B", nowMs: NOW + 2000 }).ok).toBe(true);
  });
});

describe("SET_VOLUME", () => {
  it("sets the broadcast volume and rejects a non-host", () => {
    const result = apply(freshState(), { type: "SET_VOLUME", by: "HOST", volume: 0.4 });
    const next = mustOk(result);
    expect(next.broadcastVolume).toBe(0.4);
    expect(result.ok && result.events).toEqual([{ type: "VOLUME_CHANGED", volume: 0.4 }]);

    const rejected = apply(freshState(), { type: "SET_VOLUME", by: "TEAM_A", volume: 0.4 });
    expect(!rejected.ok && rejected.error.code).toBe("FORBIDDEN_ROLE");
  });

  it("is legal in any phase, including 'intro', and never touches phase/buzz/playback state", () => {
    const result = apply(freshState(), { type: "SET_VOLUME", by: "HOST", volume: 0.2 });
    const next = mustOk(result);
    expect(next.phase).toBe("intro");
    expect(next.playbackStartedAt).toBeNull();
  });

  it("rejects an out-of-range volume", () => {
    expect(!apply(freshState(), { type: "SET_VOLUME", by: "HOST", volume: 1.5 }).ok).toBe(true);
    expect(!apply(freshState(), { type: "SET_VOLUME", by: "HOST", volume: -0.1 }).ok).toBe(true);
  });

  it("persists across REPLAY_AUDIO, PAUSE/RESUME, and NEXT_ROUND — nothing ever resets it", () => {
    let state = mustOk(apply(freshState(), { type: "SET_VOLUME", by: "HOST", volume: 0.3 }));
    state = mustOk(apply(state, { type: "START_PLAYBACK", by: "HOST", nowMs: NOW }));
    expect(state.broadcastVolume).toBe(0.3);
    state = mustOk(apply(state, { type: "REPLAY_AUDIO", by: "HOST", nowMs: NOW + 1000 }));
    expect(state.broadcastVolume).toBe(0.3);
    state = mustOk(apply(state, { type: "PAUSE_PLAYBACK", by: "HOST", nowMs: NOW + 2000 }));
    state = mustOk(apply(state, { type: "RESUME_PLAYBACK", by: "HOST", nowMs: NOW + 3000 }));
    expect(state.broadcastVolume).toBe(0.3);
    state = mustOk(apply(state, { type: "SKIP_ROUND", by: "HOST" }));
    state = mustOk(apply(state, { type: "NEXT_ROUND", by: "HOST" }));
    expect(state.broadcastVolume).toBe(0.3);
  });
});

describe("BUZZ", () => {
  function guessingState(): MusicState {
    return mustOk(apply(freshState(), { type: "START_PLAYBACK", by: "HOST", nowMs: NOW }));
  }

  it("rejects buzzing before the round's mandatory first play (still 'intro')", () => {
    const result = apply(freshState(), { type: "BUZZ", by: "TEAM_A" });
    expect(!result.ok && result.error.code).toBe("WRONG_PHASE");
  });

  it("moves to answering and records who buzzed", () => {
    const result = apply(guessingState(), { type: "BUZZ", by: "TEAM_B" });
    const next = mustOk(result);
    expect(next.phase).toBe("answering");
    expect(next.buzzedTeam).toBe("TEAM_B");
    expect(result.ok && result.events).toEqual([{ type: "TEAM_BUZZED", team: "TEAM_B" }]);
  });

  it("rejects DISPLAY/HOST buzzing", () => {
    expect(!apply(guessingState(), { type: "BUZZ", by: "HOST" }).ok).toBe(true);
    expect(!apply(guessingState(), { type: "BUZZ", by: "DISPLAY" }).ok).toBe(true);
  });

  it("rejects a team that already attempted this round from buzzing again", () => {
    // TEAM_A buzzes and answers wrong; TEAM_B steals and answers wrong too
    // (both teams now in attemptedTeams) -> round closes, so instead test
    // the narrower in-round guard directly: TEAM_A buzzed, wrong, TEAM_A
    // tries to buzz again before TEAM_B's steal.
    let state = guessingState();
    state = mustOk(apply(state, { type: "BUZZ", by: "TEAM_A" }));
    state = mustOk(apply(state, { type: "SUBMIT_ANSWER", by: "TEAM_A", text: "wrong guess" }));
    state = mustOk(apply(state, { type: "JUDGE_ANSWER", by: "HOST", correct: false })); // reopens floor, attemptedTeams=[TEAM_A]
    const result = apply(state, { type: "BUZZ", by: "TEAM_A" });
    expect(!result.ok && result.error.code).toBe("TEAM_ALREADY_ATTEMPTED");
  });
});

describe("SUBMIT_ANSWER / JUDGE_ANSWER", () => {
  function answeringState(team: "TEAM_A" | "TEAM_B" = "TEAM_A"): MusicState {
    const guessing = mustOk(apply(freshState(), { type: "START_PLAYBACK", by: "HOST", nowMs: NOW }));
    return mustOk(apply(guessing, { type: "BUZZ", by: team }));
  }

  it("rejects the OTHER team submitting an answer", () => {
    const result = apply(answeringState("TEAM_A"), { type: "SUBMIT_ANSWER", by: "TEAM_B", text: "nope" });
    expect(!result.ok && result.error.code).toBe("FORBIDDEN_ROLE");
  });

  it("rejects a second submission for the same buzz", () => {
    let state = answeringState("TEAM_A");
    state = mustOk(apply(state, { type: "SUBMIT_ANSWER", by: "TEAM_A", text: "first" }));
    const result = apply(state, { type: "SUBMIT_ANSWER", by: "TEAM_A", text: "second" });
    expect(!result.ok && result.error.code).toBe("ANSWER_ALREADY_SUBMITTED");
  });

  it("rejects judging before an answer was submitted", () => {
    const result = apply(answeringState("TEAM_A"), { type: "JUDGE_ANSWER", by: "HOST", correct: true });
    expect(!result.ok && result.error.code).toBe("ANSWER_NOT_SUBMITTED");
  });

  it("a correct judgment awards 1 point, reveals the round's real title/artist, and records history", () => {
    let state = answeringState("TEAM_A");
    state = mustOk(apply(state, { type: "SUBMIT_ANSWER", by: "TEAM_A", text: "Sample Tone" }));
    const result = apply(state, { type: "JUDGE_ANSWER", by: "HOST", correct: true });
    const next = mustOk(result);
    expect(next.phase).toBe("revealed");
    expect(next.scores.TEAM_A).toBe(1);
    expect(next.rounds[0]!.title).toBe("Sample Tone"); // real title, not redacted — this is host-eyes state
    expect(next.history).toEqual([{ roundId: "round-1", wonBy: "TEAM_A" }]);
    expect(next.buzzedTeam).toBeNull();
    expect(next.submittedAnswer).toBeNull();
  });

  it("an incorrect judgment awards nothing and reopens the floor for a steal", () => {
    let state = answeringState("TEAM_A");
    state = mustOk(apply(state, { type: "SUBMIT_ANSWER", by: "TEAM_A", text: "wrong" }));
    const result = apply(state, { type: "JUDGE_ANSWER", by: "HOST", correct: false });
    const next = mustOk(result);
    expect(next.phase).toBe("guessing"); // reopened, not revealed — round isn't over
    expect(next.scores).toEqual({ TEAM_A: 0, TEAM_B: 0 });
    expect(next.attemptedTeams).toEqual(["TEAM_A"]);
    expect(next.buzzedTeam).toBeNull();
  });

  it("a successful steal (TEAM_B correct after TEAM_A's wrong answer) awards TEAM_B the point", () => {
    let state = answeringState("TEAM_A");
    state = mustOk(apply(state, { type: "SUBMIT_ANSWER", by: "TEAM_A", text: "wrong" }));
    state = mustOk(apply(state, { type: "JUDGE_ANSWER", by: "HOST", correct: false }));
    state = mustOk(apply(state, { type: "BUZZ", by: "TEAM_B" }));
    state = mustOk(apply(state, { type: "SUBMIT_ANSWER", by: "TEAM_B", text: "Sample Tone" }));
    const result = apply(state, { type: "JUDGE_ANSWER", by: "HOST", correct: true });
    const next = mustOk(result);
    expect(next.phase).toBe("revealed");
    expect(next.scores).toEqual({ TEAM_A: 0, TEAM_B: 1 });
    expect(next.history).toEqual([{ roundId: "round-1", wonBy: "TEAM_B" }]);
  });

  it("both teams wrong closes the round with no winner and no score change", () => {
    let state = answeringState("TEAM_A");
    state = mustOk(apply(state, { type: "SUBMIT_ANSWER", by: "TEAM_A", text: "wrong" }));
    state = mustOk(apply(state, { type: "JUDGE_ANSWER", by: "HOST", correct: false }));
    state = mustOk(apply(state, { type: "BUZZ", by: "TEAM_B" }));
    state = mustOk(apply(state, { type: "SUBMIT_ANSWER", by: "TEAM_B", text: "also wrong" }));
    const result = apply(state, { type: "JUDGE_ANSWER", by: "HOST", correct: false });
    const next = mustOk(result);
    expect(next.phase).toBe("revealed");
    expect(next.scores).toEqual({ TEAM_A: 0, TEAM_B: 0 });
    expect(next.history).toEqual([{ roundId: "round-1", wonBy: null }]);
  });

  it("rejects a non-host judging", () => {
    let state = answeringState("TEAM_A");
    state = mustOk(apply(state, { type: "SUBMIT_ANSWER", by: "TEAM_A", text: "x" }));
    const result = apply(state, { type: "JUDGE_ANSWER", by: "TEAM_A", correct: true });
    expect(!result.ok && result.error.code).toBe("FORBIDDEN_ROLE");
  });
});

describe("SKIP_ROUND", () => {
  it("rejects skipping during 'intro' (nothing has started yet)", () => {
    const result = apply(freshState(), { type: "SKIP_ROUND", by: "HOST" });
    expect(!result.ok && result.error.code).toBe("WRONG_PHASE");
  });

  it("closes the round with no winner once past intro", () => {
    const guessing = mustOk(apply(freshState(), { type: "START_PLAYBACK", by: "HOST", nowMs: NOW }));
    const result = apply(guessing, { type: "SKIP_ROUND", by: "HOST" });
    const next = mustOk(result);
    expect(next.phase).toBe("revealed");
    expect(next.history).toEqual([{ roundId: "round-1", wonBy: null }]);
    expect(next.scores).toEqual({ TEAM_A: 0, TEAM_B: 0 });
  });

  it("rejects a non-host", () => {
    const guessing = mustOk(apply(freshState(), { type: "START_PLAYBACK", by: "HOST", nowMs: NOW }));
    const result = apply(guessing, { type: "SKIP_ROUND", by: "TEAM_A" });
    expect(!result.ok && result.error.code).toBe("FORBIDDEN_ROLE");
  });
});

describe("NEXT_ROUND", () => {
  function revealedState(): MusicState {
    const guessing = mustOk(apply(freshState(), { type: "START_PLAYBACK", by: "HOST", nowMs: NOW }));
    return mustOk(apply(guessing, { type: "SKIP_ROUND", by: "HOST" }));
  }

  it("rejects advancing before the round is revealed", () => {
    const result = apply(freshState(), { type: "NEXT_ROUND", by: "HOST" });
    expect(!result.ok && result.error.code).toBe("WRONG_PHASE");
  });

  it("advances to the next round in 'intro', clearing playback/buzz/answer state", () => {
    const result = apply(revealedState(), { type: "NEXT_ROUND", by: "HOST" });
    const next = mustOk(result);
    expect(next.phase).toBe("intro");
    expect(next.currentRoundIndex).toBe(1);
    expect(next.playbackStartedAt).toBeNull();
    expect(next.attemptedTeams).toEqual([]);
  });

  it("rejects a non-host", () => {
    const result = apply(revealedState(), { type: "NEXT_ROUND", by: "TEAM_A" });
    expect(!result.ok && result.error.code).toBe("FORBIDDEN_ROLE");
  });
});

describe("win conditions", () => {
  function winByCorrectAnswer(state: MusicState, team: "TEAM_A" | "TEAM_B", nowMs: number): MusicState {
    let s = mustOk(apply(state, { type: "START_PLAYBACK", by: "HOST", nowMs }));
    s = mustOk(apply(s, { type: "BUZZ", by: team }));
    s = mustOk(apply(s, { type: "SUBMIT_ANSWER", by: team, text: "correct" }));
    return mustOk(apply(s, { type: "JUDGE_ANSWER", by: "HOST", correct: true }));
  }

  it("finishes the game the instant a team reaches MUSIC_WIN_THRESHOLD, even mid-playlist", () => {
    // A long playlist (more rounds than the threshold) so we can prove the
    // game ends on the SCORE, not on running out of rounds.
    const longPlaylist: MusicConfig = {
      rounds: Array.from({ length: MUSIC_WIN_THRESHOLD + 4 }, (_, i) => ({
        id: `r${i}`,
        audioUrl: "/audio/music/sample-tone.wav",
        title: `Track ${i}`,
      })),
    };
    let state = freshState(longPlaylist);
    for (let i = 0; i < MUSIC_WIN_THRESHOLD; i++) {
      state = winByCorrectAnswer(state, "TEAM_A", NOW + i);
      if (i < MUSIC_WIN_THRESHOLD - 1) {
        state = mustOk(apply(state, { type: "NEXT_ROUND", by: "HOST" }));
      }
    }
    expect(state.status).toBe("finished");
    expect(state.winner).toBe("TEAM_A");
    expect(state.scores.TEAM_A).toBe(MUSIC_WIN_THRESHOLD);
    // Rounds 6 through the end of the playlist were never touched.
    expect(state.currentRoundIndex).toBe(MUSIC_WIN_THRESHOLD - 1);
  });

  it("running out of rounds before either team reaches the threshold still ends the game gracefully (highest score wins)", () => {
    let state = winByCorrectAnswer(freshState(), "TEAM_A", NOW); // round 1 -> TEAM_A 1-0, more rounds remain
    state = mustOk(apply(state, { type: "NEXT_ROUND", by: "HOST" }));
    state = winByCorrectAnswer(state, "TEAM_A", NOW + 1); // round 2 (the LAST round in sampleMusicPlaylist)
    expect(state.status).toBe("finished");
    expect(state.winner).toBe("TEAM_A");
    expect(state.scores.TEAM_A).toBe(2);
  });

  it("a tied score when the board runs out ends in a TIE", () => {
    let state = mustOk(apply(freshState(), { type: "START_PLAYBACK", by: "HOST", nowMs: NOW }));
    state = mustOk(apply(state, { type: "SKIP_ROUND", by: "HOST" })); // round 1: no winner
    state = mustOk(apply(state, { type: "NEXT_ROUND", by: "HOST" }));
    state = mustOk(apply(state, { type: "START_PLAYBACK", by: "HOST", nowMs: NOW + 1 }));
    state = mustOk(apply(state, { type: "SKIP_ROUND", by: "HOST" })); // round 2 (last): no winner
    expect(state.status).toBe("finished");
    expect(state.winner).toBe("TIE");
  });
});

describe("END_GAME", () => {
  it("ends immediately from any phase, highest score wins", () => {
    const guessing = mustOk(apply(freshState(), { type: "START_PLAYBACK", by: "HOST", nowMs: NOW }));
    const result = apply(guessing, { type: "END_GAME", by: "HOST" });
    const next = mustOk(result);
    expect(next.status).toBe("finished");
    expect(next.winner).toBe("TIE"); // 0-0
  });

  it("rejects a non-host and already-finished games alike", () => {
    const finished = mustOk(apply(freshState(), { type: "END_GAME", by: "HOST" }));
    expect(!apply(finished, { type: "END_GAME", by: "HOST" }).ok).toBe(true);
    expect(!apply(freshState(), { type: "END_GAME", by: "TEAM_A" }).ok).toBe(true);
  });
});

describe("toPublicView redaction", () => {
  it("HOST sees the real title/artist for every round", () => {
    const view = toPublicView(freshState(), "HOST");
    expect(view.rounds[0]!.title).toBe("Sample Tone");
    expect(view.rounds[1]!.title).toBe("Sample Tone (again)");
  });

  it("a team can't hear the current round's audio yet while it's still 'intro' (before the Host's mandatory first play)", () => {
    const view = toPublicView(freshState(), "TEAM_A");
    expect(view.rounds[0]!.audioUrl).toBe("");
    expect(view.rounds[0]!.title).toBeNull();
  });

  it("a team sees the current round's audio once playable, but not its title/artist while unrevealed", () => {
    const guessing = mustOk(apply(freshState(), { type: "START_PLAYBACK", by: "HOST", nowMs: NOW }));
    const view = toPublicView(guessing, "TEAM_A");
    expect(view.rounds[0]!.audioUrl).toBe("/audio/music/sample-tone.wav");
    expect(view.rounds[0]!.title).toBeNull();
    expect(view.rounds[0]!.artist).toBeNull();
  });

  it("blanks a future round entirely — audioUrl included, no listening ahead", () => {
    const view = toPublicView(freshState(), "TEAM_B");
    expect(view.rounds[1]!.audioUrl).toBe("");
    expect(view.rounds[1]!.title).toBeNull();
  });

  it("reveals title/artist to every role once the round is revealed", () => {
    let state = mustOk(apply(freshState(), { type: "START_PLAYBACK", by: "HOST", nowMs: NOW }));
    state = mustOk(apply(state, { type: "SKIP_ROUND", by: "HOST" }));
    const view = toPublicView(state, "DISPLAY");
    expect(view.rounds[0]!.title).toBe("Sample Tone");
  });

  it("playbackStartedAt is never redacted — genuinely public for every role", () => {
    const state = mustOk(apply(freshState(), { type: "START_PLAYBACK", by: "HOST", nowMs: NOW }));
    expect(toPublicView(state, "TEAM_A").playbackStartedAt).toBe(NOW);
    expect(toPublicView(state, "TEAM_B").playbackStartedAt).toBe(NOW);
    expect(toPublicView(state, "DISPLAY").playbackStartedAt).toBe(NOW);
  });
});

describe("availableActions", () => {
  it("HOST: only START_PLAYBACK (+SET_VOLUME/END_GAME, always available) during intro", () => {
    expect(availableActions(freshState(), "HOST")).toEqual(["START_PLAYBACK", "SET_VOLUME", "END_GAME"]);
  });

  it("a team: nothing during intro (playback hasn't started)", () => {
    expect(availableActions(freshState(), "TEAM_A")).toEqual([]);
  });

  it("a team not yet attempted: BUZZ during guessing", () => {
    const guessing = mustOk(apply(freshState(), { type: "START_PLAYBACK", by: "HOST", nowMs: NOW }));
    expect(availableActions(guessing, "TEAM_A")).toEqual(["BUZZ"]);
  });

  it("the buzzed team: SUBMIT_ANSWER while answering", () => {
    let state = mustOk(apply(freshState(), { type: "START_PLAYBACK", by: "HOST", nowMs: NOW }));
    state = mustOk(apply(state, { type: "BUZZ", by: "TEAM_A" }));
    expect(availableActions(state, "TEAM_A")).toEqual(["SUBMIT_ANSWER"]);
    expect(availableActions(state, "TEAM_B")).toEqual([]); // not their turn
  });

  it("HOST: JUDGE_ANSWER only once an answer was actually submitted (playback controls stay available throughout)", () => {
    let state = mustOk(apply(freshState(), { type: "START_PLAYBACK", by: "HOST", nowMs: NOW }));
    state = mustOk(apply(state, { type: "BUZZ", by: "TEAM_A" }));
    expect(availableActions(state, "HOST")).toEqual(["REPLAY_AUDIO", "PAUSE_PLAYBACK", "SKIP_ROUND", "SET_VOLUME", "END_GAME"]);
    state = mustOk(apply(state, { type: "SUBMIT_ANSWER", by: "TEAM_A", text: "x" }));
    expect(availableActions(state, "HOST")).toEqual(["REPLAY_AUDIO", "PAUSE_PLAYBACK", "JUDGE_ANSWER", "SKIP_ROUND", "SET_VOLUME", "END_GAME"]);
  });

  it("HOST: RESUME_PLAYBACK replaces REPLAY_AUDIO/PAUSE_PLAYBACK once paused", () => {
    let state = mustOk(apply(freshState(), { type: "START_PLAYBACK", by: "HOST", nowMs: NOW }));
    expect(availableActions(state, "HOST")).toEqual(["REPLAY_AUDIO", "PAUSE_PLAYBACK", "SKIP_ROUND", "SET_VOLUME", "END_GAME"]);
    state = mustOk(apply(state, { type: "PAUSE_PLAYBACK", by: "HOST", nowMs: NOW + 1 }));
    expect(availableActions(state, "HOST")).toEqual(["RESUME_PLAYBACK", "SKIP_ROUND", "SET_VOLUME", "END_GAME"]);
  });

  it("DISPLAY never has any actions, in any phase", () => {
    expect(availableActions(freshState(), "DISPLAY")).toEqual([]);
    const guessing = mustOk(apply(freshState(), { type: "START_PLAYBACK", by: "HOST", nowMs: NOW }));
    expect(availableActions(guessing, "DISPLAY")).toEqual([]);
  });

  it("finished game: nobody has any actions", () => {
    const finished = mustOk(apply(freshState(), { type: "END_GAME", by: "HOST" }));
    expect(availableActions(finished, "HOST")).toEqual([]);
    expect(availableActions(finished, "TEAM_A")).toEqual([]);
  });
});
