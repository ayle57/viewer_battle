import { isTeamRole, TEAM_ROLES, type ParticipantRole, type TeamRole } from "@/domain/session";
import { err, ok, type EngineResult, type GameEngine } from "../kernel";
import { addScore, checkFirstToN, leadingTeam, type Scoreboard } from "../scoring";
import { gameFinishedEvent, scoreChangedEvent } from "../events";
import {
  musicActionSchema,
  musicConfigSchema,
  type MusicAction,
  type MusicConfig,
  type MusicEvent,
  type MusicState,
} from "./types";
import { toPublicView } from "./view";

/** First to 6 correctly-judged rounds wins — the product's stated win condition ("un scoring system simple"). Not configurable per game start; a real rule, not a magic number. See types.ts's top comment. */
export const MUSIC_WIN_THRESHOLD = 6;

export function createInitialState(config: MusicConfig): MusicState {
  const parsed = musicConfigSchema.parse(config);
  return {
    status: "in_progress",
    phase: "intro",
    // `artist` is optional on the CONFIG shape (a round with no meaningful
    // artist just omits it) but `MusicRound.artist` is `string | null`
    // (types.ts's own doc comment on why: toPublicView needs a real
    // "hidden" value to redact TO, and `undefined` isn't valid state per
    // kernel.ts's "no undefined values" rule) — normalized here, once, the
    // only place a parsed config becomes real state.
    rounds: parsed.rounds.map((round) => ({ ...round, artist: round.artist ?? null })),
    currentRoundIndex: 0,
    playbackStartedAt: null,
    playbackPausedAt: null,
    broadcastVolume: 1,
    buzzedTeam: null,
    submittedAnswer: null,
    attemptedTeams: [],
    scores: { TEAM_A: 0, TEAM_B: 0 },
    winner: null,
    history: [],
  };
}

export function apply(state: MusicState, action: MusicAction): EngineResult<MusicState, MusicEvent> {
  // Re-validated regardless of the static type — see kernel.ts: `action`
  // is what a socket/tRPC handler decoded from untrusted JSON.
  const parsed = musicActionSchema.safeParse(action);
  if (!parsed.success) {
    return err("INVALID_ACTION", parsed.error.issues[0]?.message ?? "Invalid action");
  }
  const validated = parsed.data;

  if (state.status === "finished") {
    return err("GAME_ALREADY_FINISHED", "This game has already finished.");
  }

  switch (validated.type) {
    case "START_PLAYBACK":
      return applyStartPlayback(state, validated.by, validated.nowMs);
    case "REPLAY_AUDIO":
      return applyReplayAudio(state, validated.by, validated.nowMs);
    case "PAUSE_PLAYBACK":
      return applyPausePlayback(state, validated.by, validated.nowMs);
    case "RESUME_PLAYBACK":
      return applyResumePlayback(state, validated.by, validated.nowMs);
    case "SET_VOLUME":
      return applySetVolume(state, validated.by, validated.volume);
    case "BUZZ":
      return applyBuzz(state, validated.by);
    case "SUBMIT_ANSWER":
      return applySubmitAnswer(state, validated.by, validated.text);
    case "JUDGE_ANSWER":
      return applyJudgeAnswer(state, validated.by, validated.correct);
    case "SKIP_ROUND":
      return applySkipRound(state, validated.by);
    case "NEXT_ROUND":
      return applyNextRound(state, validated.by);
    case "END_GAME":
      return applyEndGame(state, validated.by);
  }
}

/**
 * The round's mandatory first shared play — the literal "premiere
 * lecture commune" ask (types.ts's top comment): nobody may BUZZ until
 * this has happened at least once (see applyBuzz's own WRONG_PHASE
 * check — "guessing" is simply unreachable before this fires). Legal
 * only from "intro"; a round that's already past it uses REPLAY_AUDIO
 * instead, so a double-click here can't "restart" the round's own
 * gating logic.
 */
function applyStartPlayback(state: MusicState, by: ParticipantRole, nowMs: number): EngineResult<MusicState, MusicEvent> {
  if (by !== "HOST") return err("FORBIDDEN_ROLE", "Only the host starts playback.");
  if (state.phase !== "intro") {
    return err("WRONG_PHASE", `Cannot start playback during phase "${state.phase}".`);
  }
  const nextState: MusicState = { ...state, phase: "guessing", playbackStartedAt: nowMs };
  return ok(nextState, [{ type: "PLAYBACK_STARTED", roundIndex: state.currentRoundIndex, startedAt: nowMs }]);
}

/** Host replaying the CURRENT round's clip again, in sync for Host+Display (Player's own playback never touches this — see types.ts's top comment). Legal any time after the round's mandatory first play; doesn't otherwise touch phase/buzz/answer state, but DOES clear any pause — a replay always resumes from 0. */
function applyReplayAudio(state: MusicState, by: ParticipantRole, nowMs: number): EngineResult<MusicState, MusicEvent> {
  if (by !== "HOST") return err("FORBIDDEN_ROLE", "Only the host can replay the clip.");
  if (state.phase === "intro" || state.playbackStartedAt === null) {
    return err("PLAYBACK_NOT_STARTED", "Start the round's first playback before replaying it.");
  }
  const nextState: MusicState = { ...state, playbackStartedAt: nowMs, playbackPausedAt: null };
  return ok(nextState, [{ type: "PLAYBACK_STARTED", roundIndex: state.currentRoundIndex, startedAt: nowMs }]);
}

/**
 * Host pausing the shared playback — for Host+Display alike (this file's
 * top comment: a local-only pause would silently desync Display, so this
 * is a real Kernel action, not client-side `audio.pause()`). Legal once
 * playback has actually started and isn't already paused.
 */
function applyPausePlayback(state: MusicState, by: ParticipantRole, nowMs: number): EngineResult<MusicState, MusicEvent> {
  if (by !== "HOST") return err("FORBIDDEN_ROLE", "Only the host can pause playback.");
  if (state.playbackStartedAt === null) {
    return err("PLAYBACK_NOT_STARTED", "Start the round's first playback before pausing it.");
  }
  if (state.playbackPausedAt !== null) {
    return err("ALREADY_PAUSED", "Playback is already paused.");
  }
  return ok({ ...state, playbackPausedAt: nowMs }, [{ type: "PLAYBACK_PAUSED", pausedAt: nowMs }]);
}

/**
 * Host resuming a paused shared playback — shifts `playbackStartedAt`
 * forward by exactly how long it was paused, so the resumed elapsed
 * offset continues from right where it left off instead of jumping
 * (types.ts's own doc comment has the exact math). Legal only while
 * genuinely paused.
 */
function applyResumePlayback(state: MusicState, by: ParticipantRole, nowMs: number): EngineResult<MusicState, MusicEvent> {
  if (by !== "HOST") return err("FORBIDDEN_ROLE", "Only the host can resume playback.");
  if (state.playbackPausedAt === null) {
    return err("NOT_PAUSED", "Playback isn't paused.");
  }
  const pausedDurationMs = nowMs - state.playbackPausedAt;
  const shiftedStartedAt = state.playbackStartedAt! + pausedDurationMs;
  return ok({ ...state, playbackStartedAt: shiftedStartedAt, playbackPausedAt: null }, [{ type: "PLAYBACK_RESUMED", startedAt: shiftedStartedAt }]);
}

/**
 * Host setting the volume Display's own `<audio>` element plays at —
 * the real, synced "control the broadcast sound" ask (types.ts's own
 * doc comment, point 3). Legal any phase, including "intro" — a Host
 * may want to pre-set it before the round's mandatory first play.
 * `volume` is already clamped to [0, 1] by `setVolumeActionSchema`
 * itself; nothing further to validate here.
 */
function applySetVolume(state: MusicState, by: ParticipantRole, volume: number): EngineResult<MusicState, MusicEvent> {
  if (by !== "HOST") return err("FORBIDDEN_ROLE", "Only the host can set the broadcast volume.");
  return ok({ ...state, broadcastVolume: volume }, [{ type: "VOLUME_CHANGED", volume }]);
}

/** Opens the buzzer race — same shape as BoardQuestionEngine's applyBuzz. The round's mandatory first play already gates this via phase: "guessing" is never reached before START_PLAYBACK fires. */
function applyBuzz(state: MusicState, by: ParticipantRole): EngineResult<MusicState, MusicEvent> {
  if (!isTeamRole(by)) return err("FORBIDDEN_ROLE", "Only a team may buzz in.");
  if (state.phase !== "guessing") {
    return err("WRONG_PHASE", `Cannot buzz during phase "${state.phase}".`);
  }
  if (state.attemptedTeams.includes(by)) {
    return err("TEAM_ALREADY_ATTEMPTED", `${by} has already attempted this round.`);
  }
  const nextState: MusicState = { ...state, phase: "answering", buzzedTeam: by, submittedAnswer: null };
  return ok(nextState, [{ type: "TEAM_BUZZED", team: by }]);
}

function applySubmitAnswer(state: MusicState, by: ParticipantRole, text: string): EngineResult<MusicState, MusicEvent> {
  if (!isTeamRole(by)) return err("FORBIDDEN_ROLE", "Only a team may submit an answer.");
  if (state.phase !== "answering" || !state.buzzedTeam) {
    return err("WRONG_PHASE", `Cannot submit an answer during phase "${state.phase}".`);
  }
  if (by !== state.buzzedTeam) {
    return err("FORBIDDEN_ROLE", "Only the team that buzzed may submit an answer.");
  }
  if (state.submittedAnswer !== null) {
    return err("ANSWER_ALREADY_SUBMITTED", `${by} already submitted an answer for this buzz.`);
  }
  const nextState: MusicState = { ...state, submittedAnswer: text };
  return ok(nextState, [{ type: "ANSWER_SUBMITTED", team: by, text }]);
}

function applyJudgeAnswer(state: MusicState, by: ParticipantRole, correct: boolean): EngineResult<MusicState, MusicEvent> {
  if (by !== "HOST") return err("FORBIDDEN_ROLE", "Only the host judges an answer.");
  if (state.phase !== "answering" || !state.buzzedTeam) {
    return err("WRONG_PHASE", `Cannot judge an answer during phase "${state.phase}".`);
  }
  if (state.submittedAnswer === null) {
    return err("ANSWER_NOT_SUBMITTED", "Wait for the team's answer before judging.");
  }
  const team = state.buzzedTeam;
  const round = state.rounds[state.currentRoundIndex];
  if (!round) return err("ROUND_NOT_FOUND", "The active round no longer exists.");

  const events: MusicEvent[] = [];

  if (correct) {
    const scores = addScore(state.scores, team, 1);
    events.push({ type: "ANSWER_JUDGED", team, correct: true });
    events.push(scoreChangedEvent(team, 1, scores));
    return finishOrContinue(closeRound(state, round.id, team, scores), events);
  }

  events.push({ type: "ANSWER_JUDGED", team, correct: false });
  const attemptedTeams = [...state.attemptedTeams, team];
  const anyTeamLeftToTry = TEAM_ROLES.some((t) => !attemptedTeams.includes(t));

  if (anyTeamLeftToTry) {
    // A steal is still possible — reopen the floor, don't close the round.
    return ok({ ...state, phase: "guessing", buzzedTeam: null, submittedAnswer: null, attemptedTeams }, events);
  }

  // Both teams tried and neither got it — the round closes with no winner.
  events.push({ type: "ROUND_CLOSED", roundId: round.id, wonBy: null });
  return finishOrContinue(closeRound({ ...state, attemptedTeams }, round.id, null, state.scores), events);
}

/**
 * Host escape hatch — "nobody's getting this one," closes the round
 * with no winner. Mirrors BoardQuestionEngine's CLOSE_QUESTION. Not
 * legal from "intro" (nothing has even started for this round yet — a
 * Host who genuinely wants out that early has END_GAME instead) or
 * "revealed" (already closed, nothing left to skip).
 */
function applySkipRound(state: MusicState, by: ParticipantRole): EngineResult<MusicState, MusicEvent> {
  if (by !== "HOST") return err("FORBIDDEN_ROLE", "Only the host can skip a round.");
  if (state.phase === "intro" || state.phase === "revealed") {
    return err("WRONG_PHASE", `Cannot skip a round during phase "${state.phase}".`);
  }
  const round = state.rounds[state.currentRoundIndex];
  if (!round) return err("ROUND_NOT_FOUND", "The active round no longer exists.");
  return finishOrContinue(closeRound(state, round.id, null, state.scores), [{ type: "ROUND_CLOSED", roundId: round.id, wonBy: null }]);
}

/** Marks a round played and reveals it — shared tail of every path that ends a round (correct answer, both teams failed, or a Host skip). Mirrors BoardQuestionEngine's closeQuestion / GeoGuessr's own reveal-and-record-history shape. */
function closeRound(state: MusicState, roundId: string, wonBy: TeamRole | null, scores: Scoreboard): MusicState {
  return {
    ...state,
    phase: "revealed",
    buzzedTeam: null,
    submittedAnswer: null,
    attemptedTeams: [],
    scores,
    history: [...state.history, { roundId, wonBy }],
  };
}

/**
 * Once a round is genuinely revealed, decides what happens next:
 * first-to-MUSIC_WIN_THRESHOLD or the board's last round just played
 * both mean the game is over now — same "decide immediately, don't wait
 * for a further action" shape as GeoGuessr's own `finishOrContinue`.
 * Otherwise the round just stays revealed, waiting for NEXT_ROUND.
 */
function finishOrContinue(state: MusicState, events: MusicEvent[]): EngineResult<MusicState, MusicEvent> {
  const reachedThreshold = checkFirstToN(state.scores, MUSIC_WIN_THRESHOLD).length > 0;
  const noMoreRounds = state.currentRoundIndex >= state.rounds.length - 1;
  if (reachedThreshold || noMoreRounds) {
    const winner = leadingTeam(state.scores) ?? "TIE";
    return ok({ ...state, status: "finished", winner }, [...events, gameFinishedEvent(winner, state.scores)]);
  }
  return ok(state, events);
}

function applyNextRound(state: MusicState, by: ParticipantRole): EngineResult<MusicState, MusicEvent> {
  if (by !== "HOST") return err("FORBIDDEN_ROLE", "Only the host advances to the next round.");
  if (state.phase !== "revealed") {
    return err("WRONG_PHASE", `Cannot advance rounds during phase "${state.phase}".`);
  }
  const nextIndex = state.currentRoundIndex + 1;
  if (nextIndex >= state.rounds.length) {
    // Defensive: finishOrContinue already finishes the game once the last
    // round is revealed, so this shouldn't normally be reachable.
    return err("NO_ROUNDS_REMAINING", "There are no more rounds to play.");
  }

  const nextState: MusicState = {
    ...state,
    phase: "intro",
    currentRoundIndex: nextIndex,
    playbackStartedAt: null,
    playbackPausedAt: null,
    buzzedTeam: null,
    submittedAnswer: null,
    attemptedTeams: [],
  };
  return ok(nextState, [{ type: "ROUND_ADVANCED", roundIndex: nextIndex }]);
}

/**
 * The one real "stop now" transition — highest current score wins, "TIE"
 * if level, whatever round was in progress is simply abandoned. Shared
 * by END_GAME (the only caller today — see applyEndGame).
 */
function finishGameNow(state: MusicState): MusicState {
  const winner = leadingTeam(state.scores) ?? "TIE";
  return {
    ...state,
    status: "finished",
    phase: "intro",
    playbackStartedAt: null,
    playbackPausedAt: null,
    buzzedTeam: null,
    submittedAnswer: null,
    attemptedTeams: [],
    winner,
  };
}

/** Host stopping the game early — same rule as every other engine's applyEndGame: highest current score wins, "TIE" if level. */
function applyEndGame(state: MusicState, by: ParticipantRole): EngineResult<MusicState, MusicEvent> {
  if (by !== "HOST") return err("FORBIDDEN_ROLE", "Only the host can end the game.");
  const winner = leadingTeam(state.scores) ?? "TIE";
  const nextState = finishGameNow(state);
  return ok(nextState, [gameFinishedEvent(winner, state.scores)]);
}

export function availableActions(state: MusicState, role: ParticipantRole): string[] {
  if (state.status === "finished") return [];
  if (role === "HOST") {
    // SET_VOLUME (the broadcast volume) is always available, same "any
    // phase, no gate" posture as END_GAME — see applySetVolume's own
    // doc comment on why "intro" is a legitimate time to pre-set it.
    const hostAlways = ["SET_VOLUME", "END_GAME"];
    // Once playback has genuinely started, the Host always has SOME
    // playback control available regardless of phase — either
    // REPLAY_AUDIO + PAUSE_PLAYBACK (currently playing) or RESUME_PLAYBACK
    // (currently paused). "intro" is excluded: `playbackStartedAt` is
    // always null there by construction, so this naturally evaluates to
    // `[]` for that phase without a special case.
    const playbackControls: string[] =
      state.playbackStartedAt === null ? [] : state.playbackPausedAt !== null ? ["RESUME_PLAYBACK"] : ["REPLAY_AUDIO", "PAUSE_PLAYBACK"];
    switch (state.phase) {
      case "intro":
        return ["START_PLAYBACK", ...hostAlways];
      case "guessing":
        return [...playbackControls, "SKIP_ROUND", ...hostAlways];
      case "answering":
        return state.submittedAnswer !== null
          ? [...playbackControls, "JUDGE_ANSWER", "SKIP_ROUND", ...hostAlways]
          : [...playbackControls, "SKIP_ROUND", ...hostAlways];
      case "revealed":
        return [...playbackControls, "NEXT_ROUND", ...hostAlways];
    }
  }
  if (!isTeamRole(role)) return []; // DISPLAY never acts
  if (state.phase === "guessing" && !state.attemptedTeams.includes(role)) return ["BUZZ"];
  if (state.phase === "answering" && state.buzzedTeam === role && state.submittedAnswer === null) return ["SUBMIT_ANSWER"];
  return [];
}

export const musicEngine: GameEngine<MusicState, MusicAction, MusicEvent, MusicConfig> = {
  id: "music",
  label: "Guess the Music",
  description: "Two teams, one speaker — buzz in first and name the track before the other team steals it.",
  meta: "2 teams · buzzer",
  hasContentStudio: true,
  createInitialState,
  apply,
  availableActions,
  toPublicView,
  getWinner: (state) => (state.status === "finished" ? state.winner : null),
};
