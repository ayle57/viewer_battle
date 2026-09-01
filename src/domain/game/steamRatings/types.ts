import { z } from "zod";
import { participantRoleSchema } from "@/domain/session";
import type { ParticipantRole, TeamRole } from "@/domain/session";
import type { GameError, GameStatus, KernelErrorCode } from "../kernel";
import type { GameFinishedEvent, ScoreChangedEvent, Scoreboard } from "..";

/**
 * Gameplay decisions locked for this vertical slice — "Guess the Game via
 * Steam Ratings": the Host shows a game's own Steam user reviews, one at
 * a time, from LEAST obvious to MOST obvious; first team to buzz in and
 * name the game right wins the round.
 *
 *   - Buzzer race, but ORAL answers, not typed — "finalement les reponses
 *     du guess the game seront orales" (a deliberate reversal of the
 *     first pass, which reused Music/BoardQuestion's SUBMIT_ANSWER step
 *     verbatim, confirmed via AskUserQuestion at the time). A team BUZZes,
 *     says their guess out loud off-app, and the Host judges directly —
 *     JUDGE_ANSWER is legal the instant a team has buzzed, no
 *     SUBMIT_ANSWER step exists at all in this engine. A wrong answer
 *     still reopens the floor for a steal, same as Music/Jeopardy.
 *   - Every correctly-judged round is worth exactly ONE point — "un
 *     scoring system simple," same as MusicEngine: first team to
 *     STEAM_RATINGS_WIN_THRESHOLD (6, engine.ts) wins the game. A Host
 *     can prepare as many rounds as they want; if the board runs out
 *     before either team reaches 6, the game still ends gracefully —
 *     highest score wins, equal scores are a "TIE", same fallback every
 *     other engine in this app already uses.
 *   - Progressive reveal, entirely Host-paced — the literal ask: "je
 *     ferai le reste... animation dans OBS," i.e. this engine's own job
 *     is exposing WHICH ratings are visible right now, not animating how
 *     they appear (that flourish is the Host's own OBS layering on top
 *     of whatever this state already broadcasts). `revealedCount` is how
 *     many of the current round's `ratings` (ordered least -> most
 *     obvious by the Host in the Content Studio) are currently visible
 *     to everyone but HOST; REVEAL_NEXT_RATING (Host-only) increments it
 *     by exactly one. Unlike MusicEngine's `playbackStartedAt`, there's
 *     no "mandatory first shared moment" requirement here — nothing in
 *     the product ask calls for one, and a round simply starts with
 *     nothing revealed yet (`revealedCount: 0`) rather than needing its
 *     own "intro" phase the way Music's mandatory-first-listen did.
 *   - Nobody may BUZZ until at least one rating has been revealed
 *     (`revealedCount > 0`) — reading zero evidence and guessing would
 *     be pure chance, not the game. REVEAL_NEXT_RATING is only legal
 *     from "guessing" (not "answering") — the reveal pauses while a team
 *     is actively answering, same "one thing happens at a time" posture
 *     BoardQuestionEngine/MusicEngine both already have for their own
 *     progression-during-a-buzz question.
 *   - Round metadata (`title`, the Steam game's own name, and
 *     `imageUrl`, its cover art) is the reference answer the Host judges
 *     a submitted guess against — same posture as MusicEngine's
 *     `title`/`artist`: hidden until `phase === "revealed"`, at which
 *     point it's shown to every role (GeoGuessr's target-reveal
 *     convention) — a round's whole payoff IS the "that was: X" beat,
 *     complete with box art, the exact "quand il reveal le jeu c'est de
 *     mettre une image" ask.
 *   - HOST explicitly advances to the next round (NEXT_ROUND) once
 *     revealed — same "host paces the show" posture as every other
 *     round-sequence engine in this app.
 *   - SKIP_ROUND (Host-only, once at least one rating has been revealed)
 *     — "nobody's getting this one," closes the round with no winner and
 *     reveals it. Same role MusicEngine's SKIP_ROUND / BoardQuestionEngine's
 *     CLOSE_QUESTION play.
 *   - END_GAME (Host-only, any phase) — same escape hatch every engine
 *     in this app has: ends now, current leader wins ("TIE" if level).
 */

export const steamRatingsRoundSchema = z.object({
  id: z.string().min(1),
  /** The reference "correct answer," judged against a team's ORAL guess by the Host (this file's top comment — no typed SUBMIT_ANSWER step exists) — the Steam game's own name. Revealed to every role once `phase === "revealed"` — see this file's top comment. */
  title: z.string().min(1),
  /** Cover art shown alongside `title` on reveal — "quand il reveal le jeu c'est de mettre une image." Same treatment as `title`: hidden until revealed. */
  imageUrl: z.string().min(1),
  /**
   * Ordered LEAST obvious -> MOST obvious, exactly as the Host prepared
   * them in the Content Studio — this array's order IS the reveal order,
   * `revealedCount` just slices into it. At least one required (nothing
   * to buzz on with zero evidence); capped at 10 — the product owner's
   * own guess ("genre 10 max tu vois je sais pas"), kept as a real Content
   * Studio bound rather than left unlimited, same "generous, not a hard
   * product rule" posture as Music's own upload size cap.
   */
  ratings: z.array(z.string().min(1)).min(1).max(10),
});
export type SteamRatingsRoundConfig = z.infer<typeof steamRatingsRoundSchema>;

export const steamRatingsConfigSchema = z.object({
  rounds: z.array(steamRatingsRoundSchema).min(1),
});
export type SteamRatingsConfig = z.infer<typeof steamRatingsConfigSchema>;

/**
 * The STATE shape's round entry — structurally a `SteamRatingsRoundConfig`
 * with `title`/`imageUrl` widened to allow `null` (toPublicView has to
 * honestly redact a hidden answer to "no value," not lie with fake text
 * — same relationship MusicRound has to MusicRoundConfig) and `ratings`
 * kept as the FULL, host-eyes list — `toPublicView` slices it down to
 * `revealedCount` entries for every other role, never mutates the
 * underlying array.
 */
export interface SteamRatingsRound {
  id: string;
  title: string | null;
  imageUrl: string | null;
  ratings: string[];
}

export type SteamRatingsPhase = "guessing" | "answering" | "revealed";

export interface PlayedSteamRatingsRound {
  roundId: string;
  /** `null` if the round closed with no correct answer (both teams tried and missed, or the Host skipped it). */
  wonBy: TeamRole | null;
}

export interface SteamRatingsState {
  status: GameStatus;
  phase: SteamRatingsPhase;
  /** Full round list, title/imageUrl/ratings included — the HOST-eyes reference shape (same posture as MusicState.rounds); toPublicView redacts title/imageUrl for everyone else until reveal, slices `ratings` down to `revealedCount`, and blanks a future round entirely. */
  rounds: SteamRatingsRound[];
  currentRoundIndex: number;
  /** How many of the CURRENT round's `ratings` are visible to everyone but HOST right now — 0..ratings.length, reset to 0 on NEXT_ROUND. This file's top comment: the whole "least obvious to most obvious" reveal is just this counter climbing, Host-paced, one at a time. */
  revealedCount: number;
  /** The team currently on the floor after a BUZZ, answering ORALLY (this file's top comment) — the Host judges directly against it, no typed-answer state to hold. `null` once judged (a fresh round, or the floor reopening after a steal). */
  buzzedTeam: TeamRole | null;
  attemptedTeams: TeamRole[];
  scores: Scoreboard;
  winner: TeamRole | "TIE" | null;
  history: PlayedSteamRatingsRound[];
}

/** Host-only, legal only from "guessing" and only while ratings remain to reveal — see engine.ts's applyRevealNextRating. */
export const revealNextRatingActionSchema = z.object({
  type: z.literal("REVEAL_NEXT_RATING"),
  by: participantRoleSchema,
});

export const buzzActionSchema = z.object({
  type: z.literal("BUZZ"),
  by: participantRoleSchema,
});

/** Host-only, legal the instant a team has buzzed — no typed-answer step to wait on (this file's top comment: answers are oral). */
export const judgeAnswerActionSchema = z.object({
  type: z.literal("JUDGE_ANSWER"),
  by: participantRoleSchema,
  correct: z.boolean(),
});

/** Host-only escape hatch — "nobody's getting this one," closes the round with no winner. Mirrors MusicEngine's SKIP_ROUND; see engine.ts's applySkipRound for exactly which phases this is legal from. */
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

export const steamRatingsActionSchema = z.discriminatedUnion("type", [
  revealNextRatingActionSchema,
  buzzActionSchema,
  judgeAnswerActionSchema,
  skipRoundActionSchema,
  nextRoundActionSchema,
  endGameActionSchema,
]);
export type SteamRatingsAction = z.infer<typeof steamRatingsActionSchema>;

export interface RatingRevealedEvent {
  type: "RATING_REVEALED";
  roundIndex: number;
  revealedCount: number;
}
export interface TeamBuzzedEvent {
  type: "TEAM_BUZZED";
  team: TeamRole;
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

export type SteamRatingsEvent =
  | RatingRevealedEvent
  | TeamBuzzedEvent
  | AnswerJudgedEvent
  | RoundClosedEvent
  | RoundAdvancedEvent
  | ScoreChangedEvent
  | GameFinishedEvent;

export type SteamRatingsErrorCode =
  | KernelErrorCode
  | "ROUND_NOT_FOUND"
  | "NO_RATINGS_REMAINING"
  | "NOTHING_REVEALED_YET"
  | "TEAM_ALREADY_ATTEMPTED"
  | "NO_ROUNDS_REMAINING";

export type SteamRatingsError = GameError<SteamRatingsErrorCode>;

/** Same shape as every other engine's isPlayableRole — DISPLAY never acts, everywhere in this app. */
export function isPlayableRole(role: ParticipantRole): role is "HOST" | TeamRole {
  return role === "HOST" || role === "TEAM_A" || role === "TEAM_B";
}
