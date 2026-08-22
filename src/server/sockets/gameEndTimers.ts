/**
 * The PRIMARY (real-time) half of the countdown-to-end-game feature — see
 * src/domain/game/geoGuessr/engine.ts's `checkExpiry` doc comment for the
 * SAFETY-NET half. A `COUNTDOWN_STARTED` event (any engine that ever adds
 * this shape, not just GeoGuessr — this module is deliberately
 * engine-agnostic, same posture as game.ts itself) means "fire this exact
 * callback at this exact deadline" — a plain, process-local
 * `Map<gameId, NodeJS.Timeout>` registry, not a job queue: this whole app
 * is one Node process (AGENTS.md), so there's nothing more durable to
 * reach for without inventing infrastructure nothing else here uses.
 *
 * Keyed by `gameId`, not sessionId — a session can only ever have one
 * game IN_PROGRESS at a time (service.ts's `startGame` guard), but
 * keying on the specific instance means a stray callback from an OLD
 * game can never be confused with a NEW one even if IDs were somehow
 * reused, and makes "cancel THIS game's timer" unambiguous.
 */
const timers = new Map<string, NodeJS.Timeout>();

/** Schedules `fire` to run once, `durationMs` from now — replacing (not stacking with) any timer already scheduled for this `gameId`, since a REPLACED countdown (a Host clicking a different duration) means the old deadline is simply void. */
export function scheduleGameEndTimer(gameId: string, durationMs: number, fire: () => void): void {
  cancelGameEndTimer(gameId);
  const handle = setTimeout(() => {
    timers.delete(gameId);
    fire();
  }, durationMs);
  timers.set(gameId, handle);
}

/** Cancels this game's pending timer, if any — a no-op if there isn't one (cancelling an already-fired or never-scheduled timer is never an error here, same "nothing to do" posture the engine's own CANCEL_COUNTDOWN has for a state with no deadline). Called on an explicit CANCEL_COUNTDOWN, on a REPLACED countdown (via scheduleGameEndTimer above), and on the game finishing by any other means (a stray timer firing after that would be a harmless no-op anyway — apply() already rejects any action once GAME_ALREADY_FINISHED — but clearing it is still the right hygiene, not dead Node timers piling up over a long streaming session). */
export function cancelGameEndTimer(gameId: string): void {
  const handle = timers.get(gameId);
  if (handle) {
    clearTimeout(handle);
    timers.delete(gameId);
  }
}
