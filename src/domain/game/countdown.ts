import { z } from "zod";
import { participantRoleSchema } from "@/domain/session";

/**
 * The Host-triggered countdown feature — shared by every engine that
 * opts in via `GameEngine.checkExpiry` (kernel.ts's own doc comment).
 * Originally GeoGuessr-only; generalized here so a second engine
 * (BoardQuestion/Mini Jeopardy) gets the identical mechanic for free
 * instead of a second, drifting copy of the same three action shapes.
 * What EXPIRY actually means is still 100% per-engine (see each
 * engine's own `resolveExpiredCountdown`/`applyCountdownExpired`-shaped
 * logic) — this module only standardizes the plumbing: the fixed
 * duration set, and the three action shapes that start/cancel/resolve
 * one.
 */
export const COUNTDOWN_DURATIONS_MS = [10_000, 30_000, 60_000] as const;
export type CountdownDurationMs = (typeof COUNTDOWN_DURATIONS_MS)[number];

/**
 * Host-only, any phase — starts (or RETARGETS, if one's already
 * running — a Host who clicks 30s then decides 10s just gets the new
 * deadline, no separate cancel step required) a countdown toward
 * whatever this engine's own COUNTDOWN_EXPIRED means. `nowMs` is
 * server-injected (src/server/sockets/game.ts), never client-controlled
 * — a client can't shorten/extend its own deadline by lying about the
 * current time.
 */
export const startCountdownActionSchema = z.object({
  type: z.literal("START_COUNTDOWN"),
  by: participantRoleSchema,
  durationMs: z.union([z.literal(10_000), z.literal(30_000), z.literal(60_000)]), // COUNTDOWN_DURATIONS_MS, spelled out literally — zod's own literal-union shape doesn't derive cleanly from the shared array constant
  nowMs: z.number(),
});

/** Host-only — cancels a currently-running countdown outright (no replacement). Errors NO_COUNTDOWN_ACTIVE if none is running. */
export const cancelCountdownActionSchema = z.object({
  type: z.literal("CANCEL_COUNTDOWN"),
  by: participantRoleSchema,
});

/**
 * Dispatched ONLY by the server itself — the real-time timer
 * (src/server/sockets/gameEndTimers.ts) re-dispatching through the
 * ordinary `apply()` path the instant a deadline passes, or replayed
 * indirectly via `checkExpiry`'s own safety-net resolution (that one
 * calls each engine's pure resolution function directly rather than
 * going through this action, but means the exact same thing). Never
 * sent by a real client action — there's nothing for a role to
 * "choose" here, the deadline itself decided. `by` still rides along
 * (every action schema needs one) but no engine's handler for this
 * action gates on it the way e.g. END_GAME gates on `by === "HOST"`.
 */
export const countdownExpiredActionSchema = z.object({
  type: z.literal("COUNTDOWN_EXPIRED"),
  by: participantRoleSchema,
});

/** `deadlineMs` here (not just "it started") is what lets the socket layer schedule the real server-side timer that actually fires COUNTDOWN_EXPIRED once it passes — see that event's own consumer for why the duration alone isn't enough (a REPLACED countdown needs the new absolute deadline, not a second relative duration stacked on top). */
export interface CountdownStartedEvent {
  type: "COUNTDOWN_STARTED";
  deadlineMs: number;
}
export interface CountdownCancelledEvent {
  type: "COUNTDOWN_CANCELLED";
}
