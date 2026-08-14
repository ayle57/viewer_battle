import type { ParticipantRole } from "@/domain/session";

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
}
