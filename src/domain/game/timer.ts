/**
 * Pure timer helpers — the pattern for any engine that needs a deadline
 * (TimedDrawingEngine, a buzzer window, ...) without reading the wall
 * clock inside `apply`. The caller (server) reads `Date.now()` and passes
 * it in as `nowMs` on the action; the engine only ever does arithmetic on
 * numbers it was handed, so `apply` stays deterministic and testable with
 * a fixed fake `nowMs` instead of real sleeps.
 *
 * Not used by BoardQuestionEngine's v1 vertical slice (no rule requires
 * a hard timer yet — see AGENTS.md "Game Kernel contract" for that
 * decision), but the pattern is real and tested here so the next engine
 * that needs it doesn't invent its own.
 */
export function computeDeadline(nowMs: number, durationMs: number): number {
  return nowMs + durationMs;
}

export function isExpired(deadlineMs: number, nowMs: number): boolean {
  return nowMs >= deadlineMs;
}

export function remainingMs(deadlineMs: number, nowMs: number): number {
  return Math.max(0, deadlineMs - nowMs);
}
