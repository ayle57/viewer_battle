import { z } from "zod";
import { participantRoleSchema } from "@/domain/session";
import type { ParticipantRole, TeamRole } from "@/domain/session";
import type { GameError, GameStatus, KernelErrorCode } from "../kernel";
import type { GameFinishedEvent, ScoreChangedEvent, Scoreboard } from "..";

/**
 * Gameplay decisions locked for this vertical slice — "Guess the Price":
 * the Host shows an item (a product name + photo, both public the whole
 * time — nothing about WHAT is being priced is ever a secret), teams
 * buzz in and TYPE a numeric price guess (a float — "ça peut être un
 * float," a deliberate reversal of this engine's first pass, which
 * reused SteamRatingsEngine's oral-answer posture verbatim), and the
 * Host judges the submitted guess against the item's real price. Same
 * buzzer-race + typed-answer skeleton as MusicEngine/BoardQuestionEngine
 * (BUZZ -> SUBMIT_ANSWER -> JUDGE_ANSWER, with a steal on a wrong
 * judgment) — `guess` is just a `number` here instead of MusicEngine's
 * free-text `text`.
 *
 *   - No progressive reveal — unlike SteamRatingsEngine's
 *     `revealedCount` climbing through a `ratings` array one at a time,
 *     this game has nothing to progressively reveal: the WHOLE item
 *     (`title`/`imageUrl`) is visible to everyone the instant a round
 *     starts. Only `price` — and its optional `marginPercent` — is the
 *     secret, hidden from every role but HOST until `phase ===
 *     "revealed"`. So BUZZ is legal the instant a round is live, no
 *     "NOTHING_REVEALED_YET" gate anywhere in this engine.
 *   - `marginPercent` is a genuinely OPTIONAL, per-item field the Host
 *     sets in the Content Studio if they want one — "il faut qu'il
 *     puisse mettre la marge de prix seul si il veut en mettre une."
 *     This engine never computes anything off it: judging a submitted
 *     guess is still a HOST call (JUDGE_ANSWER's `correct: boolean`) —
 *     `marginPercent`, when set, is purely a HOST-eyes reference shown
 *     alongside `price` and the team's own `submittedGuess` (e.g.
 *     "$49.99, ±10%, they said $52") to make that call easier, not a
 *     rule this engine auto-enforces. A hard auto-judged threshold
 *     would also be the wrong call product-wise: a Host watching chat
 *     react to "SO CLOSE" wants the final word, not a robot.
 *   - `submittedGuess`, like MusicState.submittedAnswer, is visible to
 *     EVERY role the instant it's sent — nothing to hide there, same as
 *     typing it in a shared doc on stream. It's a plain top-level state
 *     field (not nested per-round), so `toPublicView` never has to
 *     redact it — the base `{...state, rounds}` spread already exposes
 *     it to everyone.
 *   - Every correctly-judged round is worth exactly ONE point — same
 *     "un scoring system simple" posture as Music/SteamRatings: first
 *     team to GUESS_THE_PRICE_WIN_THRESHOLD (6, engine.ts) wins the
 *     game, with the same graceful "board runs out early -> highest
 *     score wins, TIE if level" fallback every other engine here has.
 *   - HOST explicitly advances to the next round (NEXT_ROUND) once
 *     revealed — same "host paces the show" posture as every other
 *     round-sequence engine in this app.
 *   - SKIP_ROUND (Host-only, any time before revealed) — "nobody's
 *     getting this one," closes the round with no winner and reveals
 *     the real price. Mirrors SteamRatingsEngine/MusicEngine's own
 *     SKIP_ROUND, minus that engine's "at least one rating revealed"
 *     precondition — there's no equivalent floor here, a round is live
 *     (and thus skippable) the instant it starts.
 *   - END_GAME (Host-only, any phase) — same escape hatch every engine
 *     in this app has: ends now, current leader wins ("TIE" if level).
 */

export const priceRoundSchema = z.object({
  id: z.string().min(1),
  /** The item's name — always public, never redacted. What the Host judges a team's typed price guess against is `price` below, not this. */
  title: z.string().min(1),
  /** Photo of the item — always public, same visibility as `title`. */
  imageUrl: z.string().min(1),
  /** The reference "correct answer," judged against a team's typed SUBMIT_ANSWER guess by the Host. Hidden from every role but HOST until `phase === "revealed"`, at which point it's shown to everyone (GeoGuessr's target-reveal convention). */
  price: z.number().positive().finite(),
  /** Optional judging aid, Host's own choice per item — this file's top comment. Same visibility as `price`: HOST-eyes only until revealed. */
  marginPercent: z.number().min(0).max(100).optional(),
});
export type PriceRoundConfig = z.infer<typeof priceRoundSchema>;

export const guessThePriceConfigSchema = z.object({
  rounds: z.array(priceRoundSchema).min(1),
});
export type GuessThePriceConfig = z.infer<typeof guessThePriceConfigSchema>;

/**
 * The STATE shape's round entry — structurally a `PriceRoundConfig` with
 * every field but `id` widened to allow `null` (toPublicView has to
 * honestly redact a hidden value to "no value," not lie with a fake one
 * — same relationship SteamRatingsRound has to SteamRatingsRoundConfig).
 * `title`/`imageUrl` are never redacted on the CURRENT or a PLAYED round
 * (this file's top comment: they're never secret) — only a genuinely
 * FUTURE round blanks them too, so nothing can be read ahead of time.
 */
export interface PriceRound {
  id: string;
  title: string | null;
  imageUrl: string | null;
  price: number | null;
  marginPercent: number | null;
}

export type GuessThePricePhase = "guessing" | "answering" | "revealed";

export interface PlayedPriceRound {
  roundId: string;
  /** `null` if the round closed with no correct answer (both teams tried and missed, or the Host skipped it). */
  wonBy: TeamRole | null;
}

export interface GuessThePriceState {
  status: GameStatus;
  phase: GuessThePricePhase;
  /** Full round list, `price`/`marginPercent` included — the HOST-eyes reference shape (same posture as SteamRatingsState.rounds); toPublicView redacts `price`/`marginPercent` for everyone else until reveal, and blanks a future round entirely (`title`/`imageUrl` included, so a player can't scrub the network tab to preview the next item). */
  rounds: PriceRound[];
  currentRoundIndex: number;
  /** The team currently on the floor after a BUZZ. `null` once judged (a fresh round, or the floor reopening after a steal). */
  buzzedTeam: TeamRole | null;
  /** What `buzzedTeam` sent via SUBMIT_ANSWER for the current buzz — `null` once the floor reopens (a fresh round, a steal). Visible to every role once sent, same posture as MusicState.submittedAnswer — this file's top comment. */
  submittedGuess: number | null;
  attemptedTeams: TeamRole[];
  scores: Scoreboard;
  winner: TeamRole | "TIE" | null;
  history: PlayedPriceRound[];
}

export const buzzActionSchema = z.object({
  type: z.literal("BUZZ"),
  by: participantRoleSchema,
});

/** The buzzing team's own typed price guess — a float, "ça peut être un float," not an integer-only cents count. Legal only from the team that currently holds the floor, once per buzz (see engine.ts's applySubmitAnswer). */
export const submitAnswerActionSchema = z.object({
  type: z.literal("SUBMIT_ANSWER"),
  by: participantRoleSchema,
  guess: z.number().min(0).finite(),
});

/** Host-only, legal once the buzzing team has actually submitted a guess (this file's top comment — no auto-judging off `marginPercent`, the Host always has the final word). */
export const judgeAnswerActionSchema = z.object({
  type: z.literal("JUDGE_ANSWER"),
  by: participantRoleSchema,
  correct: z.boolean(),
});

/** Host-only escape hatch — "nobody's getting this one," closes the round with no winner. Mirrors SteamRatingsEngine's SKIP_ROUND; see engine.ts's applySkipRound for exactly which phases this is legal from. */
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

export const guessThePriceActionSchema = z.discriminatedUnion("type", [
  buzzActionSchema,
  submitAnswerActionSchema,
  judgeAnswerActionSchema,
  skipRoundActionSchema,
  nextRoundActionSchema,
  endGameActionSchema,
]);
export type GuessThePriceAction = z.infer<typeof guessThePriceActionSchema>;

export interface TeamBuzzedEvent {
  type: "TEAM_BUZZED";
  team: TeamRole;
}
export interface AnswerSubmittedEvent {
  type: "ANSWER_SUBMITTED";
  team: TeamRole;
  guess: number;
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

export type GuessThePriceEvent =
  | TeamBuzzedEvent
  | AnswerSubmittedEvent
  | AnswerJudgedEvent
  | RoundClosedEvent
  | RoundAdvancedEvent
  | ScoreChangedEvent
  | GameFinishedEvent;

export type GuessThePriceErrorCode =
  | KernelErrorCode
  | "ROUND_NOT_FOUND"
  | "TEAM_ALREADY_ATTEMPTED"
  | "ANSWER_ALREADY_SUBMITTED"
  | "ANSWER_NOT_SUBMITTED"
  | "NO_ROUNDS_REMAINING";

export type GuessThePriceError = GameError<GuessThePriceErrorCode>;

/** Same shape as every other engine's isPlayableRole — DISPLAY never acts, everywhere in this app. */
export function isPlayableRole(role: ParticipantRole): role is "HOST" | TeamRole {
  return role === "HOST" || role === "TEAM_A" || role === "TEAM_B";
}
