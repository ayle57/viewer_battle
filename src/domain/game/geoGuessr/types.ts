import { z } from "zod";
import { participantRoleSchema } from "@/domain/session";
import type { ParticipantRole, TeamRole } from "@/domain/session";
import type { GameError, GameStatus, KernelErrorCode } from "../kernel";
import type { GameFinishedEvent, ScoreChangedEvent, Scoreboard } from "..";

/**
 * Gameplay decisions locked for this vertical slice — same spirit as
 * BoardQuestionEngine's own documented list (AGENTS.md "Game Kernel
 * contract"), specific to GeoGuessr:
 *
 *   - A round's "distance" is normalized Euclidean distance in the
 *     image's own [0,1]x[0,1] coordinate space, NOT real-world meters.
 *     This is deliberately NOT real-world GeoGuessr — the product brief
 *     is explicit that maps are streamer-provided images (fantasy game
 *     maps, fictional worlds), which have no inherent real-world scale.
 *     Fabricating a "meters" unit would be a made-up number with no
 *     basis. Keeping the kernel's own math in normalized [0,1] space
 *     also means it never needs to know an image's pixel dimensions —
 *     that's a content/rendering concern (src/domain/content), not a
 *     Game Kernel one. Formatting this for display (e.g. "8.4% off") is
 *     entirely a UI concern.
 *   - Both teams' current-round guesses are held in the SAME state
 *     object (`guesses`), unlike anything BoardQuestionEngine has —
 *     there's no per-team-private FIELD in this state, only a per-team-
 *     private VIEW of it (see view.ts's toPublicView): a team's own
 *     guess is always visible to them, the other team's guess is
 *     redacted to `null` until the round reaches "revealed". This is
 *     exactly the "redaction genuinely differs BY team" case
 *     src/domain/game/rooms.ts already flagged as a future need — see
 *     src/server/sockets/game.ts for the room-per-role broadcast this
 *     requires.
 *   - LOCK_GUESS computes the reveal itself, the instant the SECOND team
 *     locks — no separate host action, no timer. "Both teams locked" is
 *     a pure function of state (`lockedTeams.length === 2`), so the
 *     reveal (target, both guesses, distances, round winner, score
 *     update) all happen inside that one `apply()` call. Matches the
 *     kernel's "no wall-clock reads inside apply" rule trivially (reveal
 *     needs no clock at all) and means Display's whole reveal animation
 *     sequence is client-side choreography over data that's already
 *     fully known — see WHY in DisplayGeoPanel's doc comment.
 *   - A round tied on distance (exceedingly unlikely but not
 *     impossible with normalized floats) awards NO point to either
 *     team — same "TIE" vocabulary as BoardQuestionEngine's game-level
 *     tie, just applied per round here.
 *   - FIRST TO 6 rounds wins the game (GEO_WIN_THRESHOLD, engine.ts) —
 *     the product's stated win condition. If every configured round
 *     gets played before either team reaches 6 (a Host who only
 *     configured a handful of rounds), the game still ends gracefully:
 *     highest score wins, equal scores are a "TIE" — same fallback
 *     BoardQuestionEngine uses when its board runs out. This is why
 *     content readiness (src/domain/content/geoReadiness.ts) only
 *     requires "at least one complete round," not exactly 6 or 12 — the
 *     engine is correct for any positive round count.
 *   - HOST explicitly advances to the next round (NEXT_ROUND) once a
 *     round is revealed — same "host paces the show" posture as
 *     BoardQuestionEngine's SELECT_QUESTION/CLOSE_QUESTION, and lets the
 *     Display's reveal sequence actually play out on screen before the
 *     next round's image appears, instead of a timer deciding that.
 *   - END_GAME (host-only, any phase) is the same escape hatch
 *     BoardQuestionEngine has — ends now, current leader wins ("TIE" if
 *     level), whatever round was live is simply abandoned.
 */

export const geoRoundSchema = z.object({
  id: z.string().min(1),
  imageUrl: z.string().min(1),
  /** The player-facing prompt — "Where is the docking bay?" — required here for the same reason imageUrl is: readiness already guaranteed every round has one before game-start ever calls this schema (see src/domain/content/geoReadiness.ts). Visible to every role for the round's whole guessing phase, never redacted like targetX/targetY — a player can't play a round they don't know the question for. */
  question: z.string().min(1),
  /** Normalized target position, 0..1 in both axes — see this file's top comment on why not real-world coordinates. Required (non-null) here: this schema validates game-START input, where every round must already be complete (readiness already guaranteed that — see src/domain/content/geoReadiness.ts). */
  targetX: z.number().min(0).max(1),
  targetY: z.number().min(0).max(1),
  title: z.string().optional(),
});
export type GeoRoundConfig = z.infer<typeof geoRoundSchema>;

export const geoGuessrConfigSchema = z.object({
  rounds: z.array(geoRoundSchema).min(1),
});
export type GeoGuessrConfig = z.infer<typeof geoGuessrConfigSchema>;

/**
 * The STATE shape's round entry — structurally a `GeoRoundConfig` with
 * `targetX`/`targetY` widened to allow `null`, because `toPublicView`
 * (view.ts) has to honestly redact a hidden target to "no value," not
 * lie with a fake number. `createInitialState` (engine.ts) builds this
 * directly from parsed `GeoRoundConfig`s — every number is assignable to
 * `number | null`, so no cast is needed there; only the redacted VIEW
 * ever actually holds a `null`.
 */
export interface GeoRound {
  id: string;
  imageUrl: string;
  question: string;
  targetX: number | null;
  targetY: number | null;
  title?: string;
}

export type GeoGuessrPhase = "guessing" | "revealed";

export interface GeoGuess {
  x: number;
  y: number;
}

export interface GeoRoundResult {
  roundIndex: number;
  targetX: number;
  targetY: number;
  guesses: Record<TeamRole, GeoGuess>;
  /** Normalized Euclidean distance per team, lower is closer — see this file's top comment on units. */
  distances: Record<TeamRole, number>;
  roundWinner: TeamRole | "TIE";
}

export interface GeoGuessrState {
  status: GameStatus;
  phase: GeoGuessrPhase;
  /** The full round list, target included — this is the HOST-eyes reference shape (same posture as BoardQuestionState.questions holding `answer`); toPublicView redacts targetX/targetY (and imageUrl/title for rounds not yet reached) for everyone else. */
  rounds: GeoRound[];
  currentRoundIndex: number;
  /** Current round's live guesses — a team's own entry is always real once set; the OTHER team's entry is only real in the HOST's own state, redacted to `null` for every non-host, non-owning viewer until `phase === "revealed"` (view.ts). */
  guesses: Record<TeamRole, GeoGuess | null>;
  lockedTeams: TeamRole[];
  /** Populated the instant both teams have locked (see LOCK_GUESS); cleared back to `null` by NEXT_ROUND. */
  roundResult: GeoRoundResult | null;
  history: GeoRoundResult[];
  scores: Scoreboard;
  winner: TeamRole | "TIE" | null;
}

export const setGuessActionSchema = z.object({
  type: z.literal("SET_GUESS"),
  by: participantRoleSchema,
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

export const lockGuessActionSchema = z.object({
  type: z.literal("LOCK_GUESS"),
  by: participantRoleSchema,
});

/** Host-only: moves from a revealed round to the next one — see this file's top comment. Only legal once the current round is actually revealed. */
export const nextRoundActionSchema = z.object({
  type: z.literal("NEXT_ROUND"),
  by: participantRoleSchema,
});

/** Host-only, any phase — same escape hatch as BoardQuestionEngine's END_GAME. */
export const endGameActionSchema = z.object({
  type: z.literal("END_GAME"),
  by: participantRoleSchema,
});

export const geoGuessrActionSchema = z.discriminatedUnion("type", [
  setGuessActionSchema,
  lockGuessActionSchema,
  nextRoundActionSchema,
  endGameActionSchema,
]);
export type GeoGuessrAction = z.infer<typeof geoGuessrActionSchema>;

export interface GuessSetEvent {
  type: "GUESS_SET";
  team: TeamRole;
}
export interface TeamLockedEvent {
  type: "TEAM_LOCKED";
  team: TeamRole;
}
export interface RoundRevealedEvent {
  type: "ROUND_REVEALED";
  result: GeoRoundResult;
}
export interface RoundAdvancedEvent {
  type: "ROUND_ADVANCED";
  roundIndex: number;
}

export type GeoGuessrEvent =
  | GuessSetEvent
  | TeamLockedEvent
  | RoundRevealedEvent
  | RoundAdvancedEvent
  | ScoreChangedEvent
  | GameFinishedEvent;

export type GeoGuessrErrorCode =
  | KernelErrorCode
  | "ROUND_NOT_FOUND"
  | "TEAM_ALREADY_LOCKED"
  | "NO_GUESS_SET"
  | "NO_ROUNDS_REMAINING";

export type GeoGuessrError = GameError<GeoGuessrErrorCode>;

/** Same shape as BoardQuestionEngine's isPlayableRole — DISPLAY never acts, everywhere in this app. */
export function isPlayableRole(role: ParticipantRole): role is "HOST" | TeamRole {
  return role === "HOST" || role === "TEAM_A" || role === "TEAM_B";
}
