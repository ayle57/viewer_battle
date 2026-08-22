/**
 * A countdown's remaining milliseconds (useCountdownRemaining's own
 * output) as "M:SS" — floored, not rounded, so the LAST visible second
 * really is the last one (a rounded "0:01" could sit on screen for up
 * to 1.5s before the game actually ends, reading as a lie once the
 * server's own real transition lands before the display's own tick
 * would have counted down further). Pure math, no game vocabulary —
 * shared by every engine's own countdown UI (see
 * src/domain/game/countdown.ts's own doc comment), unlike e.g. each
 * engine's own gameErrorMessages.ts, which stays deliberately separate
 * per engine.
 */
export function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.floor(Math.max(0, remainingMs) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
