import { z } from "zod";
import { participantRoleSchema, teamRoleSchema } from "@/domain/session";
import type { TeamRole } from "@/domain/session";
import type { GameError, GameStatus, KernelErrorCode } from "../kernel";
import type { GameFinishedEvent, ScoreChangedEvent, Scoreboard } from "..";

/**
 * "Pointing System" — the generic, content-free scoreboard for whatever
 * the Host is playing OUTSIDE this app's own engines (the literal ask:
 * Jackbox Party games need nothing special here at all, they're already
 * a complete show on their own screen; this engine's whole job is just
 * "give the Host a way to award points and put a scoreboard on Display
 * for it," reusable across however many differently-named things get
 * played this way in a single stream).
 *
 * "ajoute des rounds et tout faut que ce soit complet" — the follow-up
 * ask this file's second pass closes: a real Jackbox Party PACK is
 * itself a sequence of separately-named mini-games (Fibbage, then
 * Quiplash, then...), each with its own points that should read as its
 * own thing, not just one number climbing forever with no shape. So
 * this engine now tracks `rounds`, same "Host paces the show" posture
 * as every round-sequence engine in this app, but genuinely open-ended
 * (no fixed board size prepared ahead of time — there IS no content
 * model here — a round exists the instant the Host says NEXT_ROUND, and
 * there's no cap on how many). `scores` stays the cumulative TOTAL
 * across every round (what END_GAME/getWinner actually judges); each
 * round in `rounds` additionally keeps its OWN sub-tally, purely for
 * the "what happened in Round 2" history a real multi-round activity
 * deserves — both updated together, atomically, by the same
 * `applyAddPoints` call, so the total is always exactly the sum of
 * every round's own tally by construction, never a separately
 * maintained (and driftable) number.
 *
 * Two things a Host changes, same as before:
 *   - `name` — what the WHOLE activity is called ("Jackbox Party").
 *   - each round's own `label` — what THIS round is called ("Fibbage",
 *     "Round 2", whatever). Defaults to "Round N" and is renamable the
 *     same way `name` is (SET_ROUND_LABEL), for a Host who wants the
 *     real mini-game's name up there instead of a bare number.
 *
 * NEXT_ROUND closes nothing and reveals nothing (there's no hidden
 * content to reveal) — it's purely "start a fresh sub-tally," legal any
 * time the game hasn't finished. END_GAME is still the only way this
 * ever finishes — same "Host says it's over, current leader wins,
 * level score is a TIE" escape hatch every other engine already has.
 */

export const pointingSystemConfigSchema = z.object({
  /** What the scoreboard is titled the moment the game starts — renamable anytime after via SET_NAME. Defaults to a generic placeholder so a Host who starts this without thinking about the name yet still gets something sane, not an empty string on screen. */
  name: z.string().trim().min(1).max(60).optional(),
});
export type PointingSystemConfig = z.infer<typeof pointingSystemConfigSchema>;

/** One labeled sub-tally within the overall activity — "Round 1: Fibbage," its own points, nothing else. `scores` here is a SLICE (this round's own deltas only), never the running total — see this file's top comment. */
export interface PointingSystemRound {
  id: string;
  label: string;
  scores: Scoreboard;
}

export interface PointingSystemState {
  status: GameStatus;
  name: string;
  /** Full history, oldest first — the LAST entry is always "the current round" (there's no separate currentRoundIndex to keep in sync: NEXT_ROUND simply appends, nothing ever un-appends). At least one entry always exists once a game has started (createInitialState seeds Round 1). */
  rounds: PointingSystemRound[];
  /** The cumulative TOTAL across every round — the one number END_GAME/getWinner actually judges. Always exactly the sum of every round's own `scores` by construction (both updated together in applyAddPoints). */
  scores: Scoreboard;
  winner: TeamRole | "TIE" | null;
}

/** Host-only, any time before the game finishes — renames the WHOLE activity, e.g. switching the header from "Jackbox Party" to "Game Night" without ending and restarting. */
export const setNameActionSchema = z.object({
  type: z.literal("SET_NAME"),
  by: participantRoleSchema,
  name: z.string().trim().min(1).max(60),
});

/** Host-only — renames the CURRENT round (the last entry in `rounds`), e.g. "Round 1" -> "Fibbage" once the Host knows what's actually being played this round. */
export const setRoundLabelActionSchema = z.object({
  type: z.literal("SET_ROUND_LABEL"),
  by: participantRoleSchema,
  label: z.string().trim().min(1).max(60),
});

/** Host-only — awards (or corrects, via a negative amount) points to one team, applied to BOTH the current round's own sub-tally and the running total. `delta` is any nonzero integer, not a fixed +1: this engine has no opinion on what an external game's own scoring looks like, it just records what the Host says happened. */
export const addPointsActionSchema = z.object({
  type: z.literal("ADD_POINTS"),
  by: participantRoleSchema,
  team: teamRoleSchema,
  delta: z.number().int().refine((n) => n !== 0, "delta must not be zero"),
});

/** Host-only — starts a fresh round (a new, zeroed sub-tally appended to `rounds`), auto-labeled "Round N". Nothing to reveal/close first (this file's top comment: no hidden content exists here), so this is legal any time the game hasn't finished — repeatable as many times as the Host's own activity has actual rounds. */
export const nextRoundActionSchema = z.object({
  type: z.literal("NEXT_ROUND"),
  by: participantRoleSchema,
});

/** Host-only, any time — same escape hatch as every other engine in this app: ends now, current leader (by the running TOTAL) wins, "TIE" if level. */
export const endGameActionSchema = z.object({
  type: z.literal("END_GAME"),
  by: participantRoleSchema,
});

export const pointingSystemActionSchema = z.discriminatedUnion("type", [
  setNameActionSchema,
  setRoundLabelActionSchema,
  addPointsActionSchema,
  nextRoundActionSchema,
  endGameActionSchema,
]);
export type PointingSystemAction = z.infer<typeof pointingSystemActionSchema>;

export interface NameChangedEvent {
  type: "NAME_CHANGED";
  name: string;
}
export interface RoundLabelChangedEvent {
  type: "ROUND_LABEL_CHANGED";
  roundId: string;
  label: string;
}
export interface RoundAdvancedEvent {
  type: "ROUND_ADVANCED";
  roundIndex: number;
}

export type PointingSystemEvent = NameChangedEvent | RoundLabelChangedEvent | RoundAdvancedEvent | ScoreChangedEvent | GameFinishedEvent;

export type PointingSystemErrorCode = KernelErrorCode;
export type PointingSystemError = GameError<PointingSystemErrorCode>;
