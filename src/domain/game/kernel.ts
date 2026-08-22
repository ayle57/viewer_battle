import type { ParticipantRole, TeamRole } from "@/domain/session";

/**
 * The Game Kernel contract — see AGENTS.md "Game Kernel contract" for the
 * full write-up of why this shape and what was rejected. Short version:
 *
 *   state + action -> Result<{ state, events }>
 *
 * one pure function per engine, no shared base class, no runtime
 * inheritance. This file only names the shared SHAPE (so /dev/game can
 * treat engines polymorphically, and so every engine documents itself the
 * same way) — it contains zero game behavior. Each engine's `apply` is
 * 100% its own implementation.
 *
 * Hard rules every engine must follow:
 *   - State is plain JSON-serializable data — no Date, Map, Set, class
 *     instances, or `undefined` values. That's what makes
 *     `JSON.stringify(state)` / `JSON.parse(...)` the entire persistence
 *     story for a future `SessionGame.internal_state` JSONB column; no
 *     custom (de)serialization per engine.
 *   - No wall-clock reads inside `apply` (`Date.now()`, `setTimeout`,
 *     ...). If an engine needs time, the caller passes `nowMs` as part of
 *     the action — see timer.ts. Same state + same action always produces
 *     the same result: that's what makes these testable with plain
 *     equality and safe to replay.
 *   - `apply` never throws. Invalid input is a `{ ok: false }` result,
 *     not an exception — see EngineResult below.
 */

/** Generic lifecycle marker every engine's state exposes, independent of that engine's own finer-grained `phase`. Lets orchestration code (not built yet) ask "is this game done?" without understanding any engine's specific phase vocabulary. */
export type GameStatus = "in_progress" | "finished";

/**
 * Error codes an engine can hit before ever reaching its own game-specific
 * logic — shared because every engine needs them, not because engines
 * share a base implementation. An engine's own error code type is a union
 * of this plus whatever's specific to it (e.g. `KernelErrorCode |
 * BoardQuestionErrorCode`).
 */
export type KernelErrorCode =
  | "INVALID_ACTION" // failed the action's own shape validation (zod)
  | "UNKNOWN_ACTION" // well-formed but not an action this engine recognizes
  | "WRONG_PHASE" // recognized, but not legal from the current phase
  | "FORBIDDEN_ROLE" // recognized and legal, but this role can't do it
  | "GAME_ALREADY_FINISHED"; // status is already "finished"; no further actions accepted

export interface GameError<TCode extends string = string> {
  code: TCode;
  message: string;
}

export interface EngineOk<TState, TEvent> {
  ok: true;
  state: TState;
  events: TEvent[];
}

export interface EngineErr<TCode extends string> {
  ok: false;
  error: GameError<TCode>;
}

/**
 * The result of applying one action. On success, `state` is the ONLY new
 * state (the engine doesn't mutate its input) and `events` is what
 * happened, in order. On failure, nothing happened — the caller keeps
 * whatever state it already had; there is no partial application.
 */
export type EngineResult<TState, TEvent, TCode extends string = string> =
  | EngineOk<TState, TEvent>
  | EngineErr<TCode>;

export function ok<TState, TEvent>(state: TState, events: TEvent[]): EngineOk<TState, TEvent> {
  return { ok: true, state, events };
}

export function err<TCode extends string>(code: TCode, message: string): EngineErr<TCode> {
  return { ok: false, error: { code, message } };
}

/**
 * The shape every engine module exposes. A structural contract for
 * /dev/game's engine registry and for future orchestration code to lean
 * on — not a class engines extend, not shared behavior. `TConfig` is
 * whatever that engine needs to start a fresh game (a question board, a
 * word list, ...); `TAction`/`TEvent` are that engine's own discriminated
 * unions.
 */
export interface GameEngine<TState, TAction, TEvent, TConfig = unknown> {
  /** Stable id, e.g. "board-question" — SessionGame.gameKey (src/server/game) and the /dev/game + registry.ts lookup key. */
  readonly id: string;
  readonly label: string;
  /** One-line, player-facing blurb — optional because it's purely a UI convenience (e.g. the Lobby's "Game selection" list, registry.ts's listGameDefinitions), not read by anything under src/domain or src/server. */
  readonly description?: string;
  /** A short tag for a compact card, e.g. "2 teams · live quiz" — deliberately separate from `description` (a full sentence): a game-selection CARD wants a glance-able tag, a game-selection LIST ITEM wants the fuller description. Optional, same reasoning as `description`. */
  readonly meta?: string;
  /**
   * Whether this engine has an editorial content model behind it (a
   * Playlist a Host can prepare before a show — see prisma/schema.prisma's
   * "Content Studio" and src/server/trpc/contentRouter.ts). Purely a UI
   * capability flag, same spirit as `description`/`meta`: nothing under
   * src/domain or src/server reads it, it only lets Content Studio's game
   * grid (src/app/host/content) ask "does this engine support content
   * authoring" without hardcoding "board-question" by name. Optional and
   * falsy by default — an engine with no content model simply omits it.
   */
  readonly hasContentStudio?: boolean;
  createInitialState(config: TConfig): TState;
  apply(state: TState, action: TAction): EngineResult<TState, TEvent>;
  /** Action `type` values this role may legally submit from the current state — used for "what can I do right now" UI hints (see /dev/game), not for authorization itself (apply() re-checks independently; never trust a UI hint as the security boundary). */
  availableActions(state: TState, role: ParticipantRole): string[];
  /**
   * The view of state that's safe to send a given (non-authoring) role —
   * e.g. redacting an answer key from everyone but the host. Optional:
   * only engines that actually have something to hide need to implement
   * it. Whoever broadcasts state (src/server/game/service.ts) calls
   * `engine.toPublicView?.(state, role) ?? state` — visibility rules are
   * game rules, so they live in the engine, not the server bridge.
   */
  toPublicView?(state: TState, viewerRole: ParticipantRole): TState;
  /**
   * Pure "has a deadline this engine is tracking passed?" check — the
   * other half of src/domain/game/timer.ts's own pattern
   * (computeDeadline/isExpired/remainingMs): an engine that stores a
   * deadline in its own state (e.g. GeoGuessrState.countdownDeadline)
   * can't read the wall clock inside `apply()` (kernel.ts's own top
   * rule), so it has nothing that can resolve that deadline on its own
   * once no further ACTION happens to trigger it. This is the one place
   * the SERVER is allowed to hand an engine the wall clock — always as
   * plain `nowMs` arithmetic input, never a live Date/timer object — so
   * `src/server/game/service.ts`'s `getCurrentGame` can self-heal a
   * game whose deadline already passed before serving/persisting it,
   * as a pure function, same testability guarantee as `apply()` itself.
   * Optional: only an engine with an actual deadline field implements
   * it (GeoGuessrEngine, for its host-triggered end-game countdown).
   * Returns the new state if something's deadline just passed and needs
   * auto-resolving, or `null` if there's nothing to do — a null keeps
   * the caller's persistence write a no-op, so a game with no active
   * deadline (the overwhelming common case, and every engine that never
   * implements this at all) costs nothing extra.
   */
  checkExpiry?(state: TState, nowMs: number): TState | null;
  /**
   * Who won THIS instance of the game, once it's finished — `null` while
   * still in progress or if the engine has no such concept. Optional and
   * deliberately tiny: this is the one hook that lets a session-level
   * "match score" (a session can run many games back to back — see
   * AGENTS.md "Session vs. Game phases") tally wins across engines
   * without any server code ever reading `internalState` directly
   * (Prisma/the bridge treat that JSON as fully opaque, same rule as
   * `toPublicView`). `src/server/db/session.ts`'s `getSessionState` is
   * the one caller, via `getGameEngine(gameKey)?.getWinner?.(state)` —
   * ties and in-progress games simply don't add up to a point for
   * either side.
   */
  getWinner?(state: TState): TeamRole | "TIE" | null;
}
