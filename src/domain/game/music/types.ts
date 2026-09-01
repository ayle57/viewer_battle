import { z } from "zod";
import { participantRoleSchema } from "@/domain/session";
import type { ParticipantRole, TeamRole } from "@/domain/session";
import type { GameError, GameStatus, KernelErrorCode } from "../kernel";
import type { GameFinishedEvent, ScoreChangedEvent, Scoreboard } from "..";

/**
 * Gameplay decisions locked for this vertical slice — "Guess the Music":
 * two teams, a streamer-uploaded audio clip per round, first to buzz in
 * and name it right wins the round.
 *
 *   - Buzzer race, deliberately reusing BoardQuestionEngine's own shape
 *     (BUZZ -> SUBMIT_ANSWER -> JUDGE_ANSWER, with a steal if the first
 *     team's answer is wrong) rather than inventing a fresh mechanic — a
 *     music-guessing round is functionally identical to a Jeopardy
 *     question once the "prompt" (an audio clip, not text) is live: one
 *     team races to answer, the Host judges, a wrong answer reopens the
 *     floor to the other team once.
 *   - Every correctly-judged round is worth exactly ONE point — no
 *     per-round point value, unlike Jeopardy's board. "Un scoring system
 *     simple": first team to MUSIC_WIN_THRESHOLD (6, engine.ts) wins the
 *     game. A Host can prepare as many rounds as they want in the
 *     Content Studio (same posture as GeoGuessr — readiness only ever
 *     requires "at least one complete round," never exactly 6); if the
 *     board runs out before either team reaches 6, the game still ends
 *     gracefully — highest score wins, equal scores are a "TIE", same
 *     fallback every other engine in this app already uses.
 *   - Playback is deliberately split into two, unrelated mechanisms:
 *       1. `playbackStartedAt`/`playbackPausedAt` (epoch ms, server-
 *          injected — never client-controlled, same trust posture as
 *          GeoGuessr's countdown `nowMs`) are the ONE shared clock
 *          Host and Display sync their own audio element to, so the
 *          audience (via Display) and the Host hear the clip together —
 *          including PAUSING together: "le host puisse baisser/monter
 *          le son, mettre sur pause" made real pause/resume a real
 *          requirement, not just play-once. `playbackStartedAt` is the
 *          anchor a live elapsed offset is computed from
 *          (`(nowMs - playbackStartedAt) / 1000`); `playbackPausedAt`,
 *          when non-null, freezes that offset at
 *          `(playbackPausedAt - playbackStartedAt) / 1000` and is
 *          ALWAYS `null` whenever `playbackStartedAt` is `null` (an
 *          engine invariant, not just convention — nothing can be
 *          "paused" before it's ever started). Set/cleared by
 *          START_PLAYBACK (the round's mandatory first shared play),
 *          REPLAY_AUDIO (restart from 0, always resumes), PAUSE_PLAYBACK/
 *          RESUME_PLAYBACK (the new pair this section documents).
 *          Nothing in this file says anything about HOW the sync
 *          actually happens client-side — that's the Host/Display
 *          panels' own concern (see HostMusicPanel/DisplayMusicPanel's
 *          doc comments, `useSyncedAudio`).
 *       2. Player's own playback is intentionally absent from this
 *          state entirely — once a round's `audioUrl` is visible (see
 *          `toPublicView` in view.ts), a player can just play/pause/
 *          replay it independently, client-side, with zero server round
 *          trip. An explicit product decision: "les joueurs peuvent
 *          lancer independamment" — Player needs no clock anchor, no
 *          action, nothing here.
 *       3. `broadcastVolume` (0..1, default 1) — a REAL, REPORTED
 *          follow-up ("ajoute plus de controle pour le host du son...
 *          j'ai l'impression que la gestion de la puissance du son
 *          fonctionne pas"): the ONLY volume control that shipped at
 *          first was the Host's own local monitor level — a plain
 *          uncontrolled client-side property, never in this state,
 *          genuinely per-listener (nobody else should hear a Host
 *          adjusting their own headphones). It silently did nothing to
 *          what the AUDIENCE actually hears via Display/OBS — the thing
 *          a streamer overwhelmingly means by "control the sound," and
 *          exactly why turning it down looked broken if the Host was
 *          judging by Display's own audio. `broadcastVolume` is the
 *          fix: real, synced, Kernel state, set by the new host-only
 *          SET_VOLUME action, applied by Display's own `<audio>`
 *          element. Deliberately does NOT reset on NEXT_ROUND/
 *          REPLAY_AUDIO/finishing — a Host who dialed the stream down
 *          for a loud clip shouldn't have it silently snap back up next
 *          track. Host's own local monitor slider stays completely
 *          separate and untouched by this — same "per-listener vs.
 *          broadcast" split pause/resume already proved out for
 *          playback state itself.
 *   - Nobody may BUZZ until the round's mandatory first shared play has
 *      happened (`playbackStartedAt !== null`, i.e. phase has left
 *      "intro") — the literal ask: "il doit y avoir une premiere
 *      lecture commune pour chaque musique." This also means the
 *      audience watching via Display always hears a clip at least once
 *      before either team can already be answering it.
 *   - Round metadata (`title`/optional `artist`) is the reference
 *     answer the Host judges a submitted guess against — same posture
 *     as BoardQuestionEngine's `answer` — EXCEPT it's revealed to every
 *     role once the round reaches "revealed" (GeoGuessr's target-reveal
 *     convention, not BoardQuestion's "never shown to the audience"
 *     one): a music-quiz round's whole payoff IS the "that was: X by Y"
 *     beat, same energy as GeoGuessr showing where the target actually
 *     was.
 *   - HOST explicitly advances to the next round (NEXT_ROUND) once
 *     revealed — same "host paces the show" posture as the other two
 *     round-sequence engines.
 *   - SKIP_ROUND (Host-only, once a round has actually started) —
 *     "nobody's getting this one," closes the round with no winner and
 *     reveals it. Same role BoardQuestionEngine's CLOSE_QUESTION plays.
 *   - END_GAME (Host-only, any phase) — same escape hatch every engine
 *     in this app has: ends now, current leader wins ("TIE" if level).
 */

export const musicRoundSchema = z.object({
  id: z.string().min(1),
  audioUrl: z.string().min(1),
  /** The reference "correct answer," judged against a team's free-text SUBMIT_ANSWER by the Host — required here for the same reason GeoGuessr's `question`/`targetX`/`targetY` are: readiness already guarantees every round has one before game-start ever calls this schema (src/domain/content/musicReadiness.ts). Revealed to every role once `phase === "revealed"` — see this file's top comment on why this engine reveals its answer, unlike BoardQuestionEngine's. */
  title: z.string().min(1),
  /** Optional extra reference shown alongside `title` on reveal (e.g. "Bohemian Rhapsody" / "Queen") — never required, some clips (instrumentals, game/movie themes, memes) have no meaningful separate "artist." */
  artist: z.string().optional(),
});
export type MusicRoundConfig = z.infer<typeof musicRoundSchema>;

export const musicConfigSchema = z.object({
  rounds: z.array(musicRoundSchema).min(1),
});
export type MusicConfig = z.infer<typeof musicConfigSchema>;

/**
 * The STATE shape's round entry — structurally a `MusicRoundConfig` with
 * `title`/`artist` widened to allow `null`, because `toPublicView`
 * (view.ts) has to honestly redact a hidden answer to "no value," not
 * lie with fake text. Same relationship GeoRound has to GeoRoundConfig
 * (see that type's own doc comment) — `createInitialState` builds this
 * directly from parsed `MusicRoundConfig`s, no cast needed; only the
 * redacted VIEW ever actually holds a `null`.
 */
export interface MusicRound {
  id: string;
  audioUrl: string;
  title: string | null;
  artist: string | null;
}

export type MusicPhase = "intro" | "guessing" | "answering" | "revealed";

export interface PlayedMusicRound {
  roundId: string;
  /** `null` if the round closed with no correct answer (both teams tried and missed, or the Host skipped it). */
  wonBy: TeamRole | null;
}

export interface MusicState {
  status: GameStatus;
  phase: MusicPhase;
  /** Full round list, title/artist included — the HOST-eyes reference shape (same posture as BoardQuestionState.questions / GeoGuessrState.rounds); toPublicView redacts title/artist for everyone else until reveal, and blanks a future round entirely. */
  rounds: MusicRound[];
  currentRoundIndex: number;
  /**
   * Epoch ms of this round's most recent SHARED playback trigger (the
   * Host's START_PLAYBACK or REPLAY_AUDIO) — `null` in "intro", before
   * the Host has played the clip even once. Genuinely public (every
   * role sees the identical number, same posture as GeoGuessr's
   * `countdownDeadline`) — `toPublicView` never touches this field.
   * Host and Display sync their own `<audio>` element to it; Player
   * ignores it entirely (see this file's top comment).
   */
  playbackStartedAt: number | null;
  /**
   * `null` unless playback is CURRENTLY paused, in which case this is the
   * epoch ms the pause happened — see this file's top comment for the
   * offset math and the "always null when playbackStartedAt is null"
   * invariant. Genuinely public, same posture as `playbackStartedAt`
   * itself — `toPublicView` never touches either.
   */
  playbackPausedAt: number | null;
  /**
   * The volume Display's own `<audio>` element should play at, 0..1 —
   * see this file's top comment (point 3) for why this is genuine synced
   * state, not a client-side-only property like the Host's own monitor
   * volume. Genuinely public, same posture as `playbackStartedAt`/
   * `playbackPausedAt` — `toPublicView` never touches it. Defaults to 1
   * (full volume, the browser's own native default) and persists across
   * rounds/replays — nothing in this engine ever resets it back.
   */
  broadcastVolume: number;
  buzzedTeam: TeamRole | null;
  /** What `buzzedTeam` sent via SUBMIT_ANSWER for the current buzz — `null` once the floor reopens (a fresh round, a steal). Visible to every role once sent, same posture as BoardQuestionState.submittedAnswer — nothing to hide there, same as speaking it on a live stream. */
  submittedAnswer: string | null;
  attemptedTeams: TeamRole[];
  scores: Scoreboard;
  winner: TeamRole | "TIE" | null;
  history: PlayedMusicRound[];
}

/**
 * Host-only, legal only from "intro" — the round's mandatory first
 * shared play (this file's top comment). `nowMs` is server-injected,
 * same trust posture as GeoGuessr's START_COUNTDOWN `nowMs`
 * (src/server/sockets/game.ts) — never taken from client input, so a
 * client can't lie about when playback "really" started.
 */
export const startPlaybackActionSchema = z.object({
  type: z.literal("START_PLAYBACK"),
  by: participantRoleSchema,
  nowMs: z.number(),
});

/** Host replaying the CURRENT round's clip again, in sync for Host+Display — legal any time after the round's mandatory first play (i.e. once past "intro"); doesn't touch phase/buzz/answer state at all, just re-anchors `playbackStartedAt` and clears any pause. */
export const replayAudioActionSchema = z.object({
  type: z.literal("REPLAY_AUDIO"),
  by: participantRoleSchema,
  nowMs: z.number(),
});

/** Host pausing the shared playback for Host+Display alike — legal once playback has actually started and isn't already paused. `nowMs` server-injected, same trust posture as every other timestamp here. */
export const pausePlaybackActionSchema = z.object({
  type: z.literal("PAUSE_PLAYBACK"),
  by: participantRoleSchema,
  nowMs: z.number(),
});

/** Host resuming a paused shared playback — legal only while genuinely paused; shifts `playbackStartedAt` forward by the exact paused duration so the resumed offset picks up right where it left off. */
export const resumePlaybackActionSchema = z.object({
  type: z.literal("RESUME_PLAYBACK"),
  by: participantRoleSchema,
  nowMs: z.number(),
});

/** Host setting the volume Display's own `<audio>` element plays at — see MusicState.broadcastVolume's own doc comment (point 3, this file's top comment). Legal any phase, including "intro" (a Host may want to pre-set it before the round's first play). Never resets on its own. */
export const setVolumeActionSchema = z.object({
  type: z.literal("SET_VOLUME"),
  by: participantRoleSchema,
  volume: z.number().min(0).max(1),
});

export const buzzActionSchema = z.object({
  type: z.literal("BUZZ"),
  by: participantRoleSchema,
});

export const submitAnswerActionSchema = z.object({
  type: z.literal("SUBMIT_ANSWER"),
  by: participantRoleSchema,
  text: z.string().trim().min(1),
});

export const judgeAnswerActionSchema = z.object({
  type: z.literal("JUDGE_ANSWER"),
  by: participantRoleSchema,
  correct: z.boolean(),
});

/** Host-only escape hatch — "nobody's getting this one," closes the round with no winner. Mirrors BoardQuestionEngine's CLOSE_QUESTION; see engine.ts's applySkipRound for exactly which phases this is legal from. */
export const skipRoundActionSchema = z.object({
  type: z.literal("SKIP_ROUND"),
  by: participantRoleSchema,
});

/** Host-only: moves from a revealed round to the next one — see this file's top comment. Only legal once the current round is actually revealed. */
export const nextRoundActionSchema = z.object({
  type: z.literal("NEXT_ROUND"),
  by: participantRoleSchema,
});

/** Host-only, any phase — same escape hatch as every other engine in this app. */
export const endGameActionSchema = z.object({
  type: z.literal("END_GAME"),
  by: participantRoleSchema,
});

export const musicActionSchema = z.discriminatedUnion("type", [
  startPlaybackActionSchema,
  replayAudioActionSchema,
  pausePlaybackActionSchema,
  resumePlaybackActionSchema,
  setVolumeActionSchema,
  buzzActionSchema,
  submitAnswerActionSchema,
  judgeAnswerActionSchema,
  skipRoundActionSchema,
  nextRoundActionSchema,
  endGameActionSchema,
]);
export type MusicAction = z.infer<typeof musicActionSchema>;

export interface PlaybackStartedEvent {
  type: "PLAYBACK_STARTED";
  roundIndex: number;
  startedAt: number;
}
export interface PlaybackPausedEvent {
  type: "PLAYBACK_PAUSED";
  pausedAt: number;
}
export interface PlaybackResumedEvent {
  type: "PLAYBACK_RESUMED";
  startedAt: number;
}
export interface VolumeChangedEvent {
  type: "VOLUME_CHANGED";
  volume: number;
}
export interface TeamBuzzedEvent {
  type: "TEAM_BUZZED";
  team: TeamRole;
}
export interface AnswerSubmittedEvent {
  type: "ANSWER_SUBMITTED";
  team: TeamRole;
  text: string;
}
export interface AnswerJudgedEvent {
  type: "ANSWER_JUDGED";
  team: TeamRole;
  correct: boolean;
}
export interface RoundClosedEvent {
  type: "ROUND_CLOSED";
  roundId: string;
  wonBy: TeamRole | null;
}
export interface RoundAdvancedEvent {
  type: "ROUND_ADVANCED";
  roundIndex: number;
}

export type MusicEvent =
  | PlaybackStartedEvent
  | PlaybackPausedEvent
  | PlaybackResumedEvent
  | VolumeChangedEvent
  | TeamBuzzedEvent
  | AnswerSubmittedEvent
  | AnswerJudgedEvent
  | RoundClosedEvent
  | RoundAdvancedEvent
  | ScoreChangedEvent
  | GameFinishedEvent;

export type MusicErrorCode =
  | KernelErrorCode
  | "ROUND_NOT_FOUND"
  | "PLAYBACK_NOT_STARTED"
  | "ALREADY_PAUSED"
  | "NOT_PAUSED"
  | "TEAM_ALREADY_ATTEMPTED"
  | "ANSWER_ALREADY_SUBMITTED"
  | "ANSWER_NOT_SUBMITTED"
  | "NO_ROUNDS_REMAINING";

export type MusicError = GameError<MusicErrorCode>;

/** Same shape as the other two engines' isPlayableRole — DISPLAY never acts, everywhere in this app. */
export function isPlayableRole(role: ParticipantRole): role is "HOST" | TeamRole {
  return role === "HOST" || role === "TEAM_A" || role === "TEAM_B";
}
