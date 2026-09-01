import { z } from "zod";
import { participantRoleSchema } from "@/domain/session";
import type { ParticipantRole, TeamRole } from "@/domain/session";
import type { GameError, GameStatus, KernelErrorCode } from "../kernel";
import type { GameFinishedEvent, ScoreChangedEvent, Scoreboard, CountdownStartedEvent, CountdownCancelledEvent } from "..";

/**
 * Gameplay decisions locked for this vertical slice — same spirit as
 * BoardQuestionEngine/GeoGuessrEngine's own documented lists (AGENTS.md
 * "Game Kernel contract"), specific to Drawing. Confirmed with the product
 * owner, literal cahier des charges flow:
 *
 *   - One team is ACTIVE at a time. Either of its two players may claim
 *     the draw with CHOOSE_DRAWER — first valid claim wins (a race, same
 *     shape as BoardQuestionEngine's BUZZ), the other player becomes the
 *     guesser for this turn. There's no separate "reveal whose turn it
 *     is" step — a fresh turn starts directly in `"choosing_drawer"`.
 *   - The prompt (the word/character to draw) is a genuine secret: only
 *     the HOST and the chosen drawer ever see it. Unlike GeoGuessr's
 *     per-TEAM redaction, this is per-PLAYER — the drawer's own teammate
 *     must NOT see it (they're the one guessing). Because Socket.IO
 *     broadcasts (src/server/sockets/game.ts's broadcastGameSnapshot) are
 *     genuinely per-ROLE, not per-participant, `toPublicView` below
 *     cannot be the delivery mechanism for the drawer's own copy — it can
 *     only ever BLANK the word for everyone (host excepted). The actual
 *     "tell the drawer the word" step is a separate, per-socket, pull-
 *     based exchange over the ephemeral drawing channel
 *     (src/server/sockets/drawing.ts's `drawing:request-prompt`), keyed
 *     off `drawerName` matching the requesting socket's own displayName —
 *     the same "player identity = displayName" convention GeoGuessr's
 *     `GeoProposal.byName` already established (no `seat`/participantId
 *     concept reaches the Game Kernel anywhere in this app).
 *   - The timer is server-authoritative and per-PROMPT, not a Host-picked
 *     live duration — it comes from Content Studio
 *     (PlaylistPrompt.durationSeconds, src/domain/content/drawingMapping.ts),
 *     snapshotted into `prompts[i].durationSeconds` at game start exactly
 *     like every other piece of content. CHOOSE_DRAWER computes and emits
 *     its own COUNTDOWN_STARTED the instant a drawer is chosen — reusing
 *     `computeDeadline`/the shared event SHAPE from
 *     src/domain/game/{timer,countdown}.ts so the existing, UNCHANGED
 *     `scheduleCountdownIfAny`/gameEndTimers.ts machinery picks it up for
 *     free — but deliberately NOT the shared `startCountdownActionSchema`
 *     (its hardcoded 10/30/60s enum doesn't fit author-configurable
 *     durations); there is no player-facing START_COUNTDOWN action here.
 *   - The HOST may adjust the running drawing countdown up or down mid-
 *     round (ADJUST_COUNTDOWN — "add 10s for a hard prompt," "cut it
 *     short") — the timer is server-authoritative and per-prompt by
 *     default, but the Host still has live control, same "give more time
 *     for complicated tasks" ask the per-prompt duration itself answers
 *     at content-authoring time. Reuses the exact same RETARGET mechanism
 *     GeoGuessr's own START_COUNTDOWN already established (a fresh
 *     `COUNTDOWN_STARTED { deadlineMs }` event — `scheduleCountdownIfAny`/
 *     gameEndTimers.ts, both unmodified, already cancel-and-reschedule on
 *     a second `COUNTDOWN_STARTED` for the same game): this file doesn't
 *     invent a second real-time mechanism, it just emits the shared event
 *     shape again with a new deadline. Clamped to never land less than 1s
 *     in the future — a Host removing more time than remains still gets a
 *     real, short countdown, not an instant/negative one.
 *   - When the countdown expires (COUNTDOWN_EXPIRED, same server-dispatch
 *     convention as both other engines), the round moves straight to
 *     `"guessing"` — no host action needed to stop drawing.
 *   - The HOST judges the guess (JUDGE_GUESS), same posture as
 *     BoardQuestionEngine's JUDGE_ANSWER — players guess out loud/in chat,
 *     there is no in-app guess-text field. Correct awards the ACTIVE
 *     team a point; incorrect awards the point to the OTHER team
 *     automatically (the cahier's literal rule — the other team never
 *     has to do anything to earn it). Either way the turn moves to
 *     `"resolved"` — the judged outcome stays on screen (same "a real
 *     reaction beat, not an instant cut" posture as GeoGuessr's own
 *     "guessing" -> "revealed") — and the Host explicitly paces the show
 *     on to the next prompt with NEXT_PROMPT, straight back into
 *     `"choosing_drawer"` for the OTHER team. A REAL, REPORTED gap this
 *     closes: judging used to cut straight to the next turn in the same
 *     action, giving the Host no beat to actually see who just won the
 *     point before the next prompt was already live.
 *   - NEXT_PROMPT (Host-only, only legal once `"resolved"`) is the pacing
 *     action described above — same "Host paces the show" posture as
 *     GeoGuessr's own NEXT_ROUND, and the one place the turn's team/index
 *     actually advance.
 *   - SKIP_TURN (Host-only, any phase before `"resolved"`) — "this prompt
 *     isn't working out," no winner, no score change either way. Reuses
 *     the SAME `"resolved"` pause NEXT_PROMPT already paces through
 *     (rather than a separate instant-advance path) — same role as
 *     MusicEngine's/SteamRatingsEngine's/GuessThePriceEngine's own
 *     SKIP_ROUND. Still counts as this team's turn for alternation
 *     purposes (the other team is up next, exactly like a judged turn).
 *   - FIRST TO DRAWING_WIN_THRESHOLD (6) round-wins takes the match — same
 *     "first to N" product rule as GeoGuessr's GEO_WIN_THRESHOLD. If the
 *     playlist runs out of prompts before either team reaches 6, the game
 *     still ends gracefully: highest score wins, equal scores are a
 *     "TIE" — the identical fallback both other engines use. Reaching
 *     either condition finishes the game the instant it's judged/skipped
 *     (phase stays `"resolved"`, so the final turn's own outcome is still
 *     visible) — no further NEXT_PROMPT needed, same "decide immediately"
 *     shape as GeoGuessr's own finishOrContinue.
 *   - END_GAME (host-only, any phase) is the same escape hatch as both
 *     other engines.
 */

export const drawingPromptSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  durationSeconds: z.number().int().positive(),
});
export type DrawingPromptConfig = z.infer<typeof drawingPromptSchema>;

export const drawingConfigSchema = z.object({
  prompts: z.array(drawingPromptSchema).min(1),
});
export type DrawingConfig = z.infer<typeof drawingConfigSchema>;

/** The STATE shape's prompt entry — identical to DrawingPromptConfig; `apply` always runs against real, full, host-eyes state (see this file's top comment), only the redacted VIEW (view.ts) ever blanks `text`. */
export interface DrawingPrompt {
  id: string;
  text: string;
  durationSeconds: number;
}

/**
 * `"resolved"` — a turn was just judged (JUDGE_GUESS) or skipped
 * (SKIP_TURN) and the outcome is on screen; `activeTeam`/`drawerName`/
 * `currentPromptIndex` all still describe the JUST-FINISHED turn, not the
 * next one — NEXT_PROMPT is what actually advances them. See this file's
 * top comment for the full "why a pause" reasoning.
 */
export type DrawingPhase = "choosing_drawer" | "drawing" | "guessing" | "resolved";

/**
 * One resolved turn — kept even after the round moves on, for a recap UI.
 * `promptText` is deliberately real/unredacted here: by the time a turn is
 * in `history` it's already been drawn and judged/skipped live, nothing
 * left to protect. `drawerName` is `null` for a turn SKIP_TURN closed
 * before anyone was ever chosen to draw (legal from `"choosing_drawer"`
 * — see SKIP_TURN's own doc comment). `correct` is `null` exactly for a
 * skipped turn — never judged either way, same "no winner" vocabulary
 * SteamRatingsEngine's own `wonBy: null` history entry uses.
 */
export interface DrawingTurnResult {
  promptId: string;
  promptText: string;
  team: TeamRole;
  drawerName: string | null;
  correct: boolean | null;
}

export interface DrawingState {
  status: GameStatus;
  phase: DrawingPhase;
  /** The full prompt list, text included — this is the HOST-eyes reference shape (same posture as BoardQuestionState.questions holding `answer`); toPublicView (view.ts) blanks `text` for the current/future prompts for every other role. */
  prompts: DrawingPrompt[];
  currentPromptIndex: number;
  activeTeam: TeamRole;
  /**
   * The current drawer's own displayName, or `null` before one's chosen
   * this turn — genuinely PUBLIC once set (the teammate needs to know
   * WHO is drawing, just not the word itself), so `toPublicView` never
   * touches this field. Matched against a requesting socket's own
   * `SocketIdentity.displayName` by the ephemeral drawing channel
   * (src/server/sockets/drawing.ts) to authorize both stroke sends and
   * the private prompt-reveal pull — same "player identity = displayName"
   * convention as GeoGuessr's GeoProposal.byName (no participantId/seat
   * concept reaches the Game Kernel).
   */
  drawerName: string | null;
  /** Epoch ms, same clock as src/domain/game/timer.ts's computeDeadline — null when no drawing countdown is running (every phase other than "drawing"). Genuinely public, same as GeoGuessr's countdownDeadline — every role sees the same number, toPublicView never touches it. */
  countdownDeadline: number | null;
  scores: Scoreboard;
  winner: TeamRole | "TIE" | null;
  history: DrawingTurnResult[];
}

// `by` is the full participantRoleSchema on every action here, not a
// literal restricted to the "right" role(s) — role authorization is
// checked explicitly in engine.ts (-> FORBIDDEN_ROLE), same convention as
// both other engines.

/**
 * Either player on the active team may send this — first valid claim
 * wins (a race, same shape as BoardQuestionEngine's BUZZ). `byName` is
 * server-injected from the sending socket's own identity
 * (src/server/sockets/game.ts), never client-controlled beyond this
 * schema's plain non-empty-string shape. `nowMs` is likewise
 * server-injected (same field every action gets, see game.ts) — needed
 * here because choosing a drawer computes THIS turn's own countdown
 * deadline (kernel.ts's "no wall-clock reads inside apply" rule means the
 * caller must hand the engine the current time, never read it itself).
 */
export const chooseDrawerActionSchema = z.object({
  type: z.literal("CHOOSE_DRAWER"),
  by: participantRoleSchema,
  byName: z.string().min(1),
  nowMs: z.number(),
});

/** Host-only: judges the guess the (silent, out-loud) guesser just made. Only legal during `"guessing"`; moves to `"resolved"` — see this file's top comment on why judging no longer advances the turn directly. */
export const judgeGuessActionSchema = z.object({
  type: z.literal("JUDGE_GUESS"),
  by: participantRoleSchema,
  correct: z.boolean(),
});

/** Host-only: paces on to the next prompt once a turn is `"resolved"` — see this file's top comment. Mirrors GeoGuessrEngine's own NEXT_ROUND. */
export const nextPromptActionSchema = z.object({
  type: z.literal("NEXT_PROMPT"),
  by: participantRoleSchema,
});

/** Host-only escape hatch — "this prompt isn't working out," closes the turn with no winner. Only legal before `"resolved"` (already closed, nothing left to skip) — mirrors MusicEngine's/SteamRatingsEngine's/GuessThePriceEngine's own SKIP_ROUND. See this file's top comment. */
export const skipTurnActionSchema = z.object({
  type: z.literal("SKIP_TURN"),
  by: participantRoleSchema,
});

/**
 * Host-only: nudges the running drawing countdown by `deltaSeconds`
 * (positive to add time, negative to remove it) — only legal during
 * `"drawing"`, while a countdown is actually running. `nowMs` is
 * server-injected the same way every other action's is; the engine
 * clamps the resulting deadline to never land in the past (see this
 * file's top comment).
 */
export const adjustCountdownActionSchema = z.object({
  type: z.literal("ADJUST_COUNTDOWN"),
  by: participantRoleSchema,
  deltaSeconds: z.number().int(),
  nowMs: z.number(),
});

/**
 * Dispatched ONLY by the server itself (src/server/sockets/gameEndTimers.ts
 * re-dispatching through the ordinary `apply()` path, or replayed
 * indirectly via `checkExpiry`'s own safety-net resolution) — never sent
 * by a real client action, same convention as both other engines' own
 * COUNTDOWN_EXPIRED. `nowMs`/`by` still ride along (every action needs
 * one) but nothing here gates on `by` the way END_GAME gates on
 * `by === "HOST"`.
 */
export const countdownExpiredActionSchema = z.object({
  type: z.literal("COUNTDOWN_EXPIRED"),
  by: participantRoleSchema,
});

/** Host-only, any phase: ends the game right now instead of waiting for the playlist to run out — see engine.ts's `applyEndGame`. */
export const endGameActionSchema = z.object({
  type: z.literal("END_GAME"),
  by: participantRoleSchema,
});

export const drawingActionSchema = z.discriminatedUnion("type", [
  chooseDrawerActionSchema,
  judgeGuessActionSchema,
  nextPromptActionSchema,
  skipTurnActionSchema,
  adjustCountdownActionSchema,
  countdownExpiredActionSchema,
  endGameActionSchema,
]);
export type DrawingAction = z.infer<typeof drawingActionSchema>;

export interface DrawerChosenEvent {
  type: "DRAWER_CHOSEN";
  team: TeamRole;
  drawerName: string;
}
export interface GuessJudgedEvent {
  type: "GUESS_JUDGED";
  team: TeamRole;
  correct: boolean;
}
/** Emitted only by SKIP_TURN — mirrors GuessJudgedEvent's shape minus `correct` (there's nothing to judge). */
export interface TurnSkippedEvent {
  type: "TURN_SKIPPED";
  team: TeamRole;
}
export interface TurnAdvancedEvent {
  type: "TURN_ADVANCED";
  promptIndex: number;
  activeTeam: TeamRole;
}

// CountdownStartedEvent is the shared ../countdown one (imported above).
// CountdownCancelledEvent (also shared) is only ever emitted by SKIP_TURN
// cancelling an in-progress drawing countdown out from under it — there's
// still no player-facing CANCEL_COUNTDOWN action here (this file's top
// comment on why the timer is otherwise fully automatic).

export type DrawingEvent =
  | DrawerChosenEvent
  | GuessJudgedEvent
  | TurnSkippedEvent
  | TurnAdvancedEvent
  | CountdownStartedEvent
  | CountdownCancelledEvent
  | ScoreChangedEvent
  | GameFinishedEvent;

export type DrawingErrorCode = KernelErrorCode | "NO_COUNTDOWN_ACTIVE" | "NO_PROMPTS_REMAINING";
export type DrawingError = GameError<DrawingErrorCode>;

/** Same shape as both other engines' isPlayableRole — DISPLAY never acts, everywhere in this app. */
export function isPlayableRole(role: ParticipantRole): role is "HOST" | TeamRole {
  return role === "HOST" || role === "TEAM_A" || role === "TEAM_B";
}
