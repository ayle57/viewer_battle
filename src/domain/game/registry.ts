import { boardQuestionEngine } from "./boardQuestion";
import type { GameEngine } from "./kernel";

/**
 * Every engine that exists, keyed by its own `id`. The one place that
 * knows all engines by name — a lookup table, not shared behavior; each
 * entry is still 100% its own module. `src/server/game` dispatches
 * `SessionGame.gameKey` through this; `/dev/game` uses it as its engine
 * picker.
 *
 * `GameEngine<any, any, any, any>` here is deliberate type erasure: a
 * registry that can hold engines with different State/Action/Event shapes
 * can't also know those shapes statically. Callers that need the real
 * types work with one specific engine's module directly (e.g.
 * `@/domain/game/boardQuestion`), not through this registry.
 */
export const gameEngines: Record<string, GameEngine<any, any, any, any>> = {
  [boardQuestionEngine.id]: boardQuestionEngine,
};

export type GameKey = keyof typeof gameEngines;

export function getGameEngine(gameKey: string) {
  return gameEngines[gameKey];
}
