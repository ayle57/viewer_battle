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

export interface GameDefinition {
  id: string;
  label: string;
  description?: string;
  meta?: string;
  hasContentStudio?: boolean;
}

/**
 * The registry, projected down to what a "pick a game" UI needs (the
 * Lobby's Game selection — see AGENTS.md) and nothing else — a component
 * that just wants to list available games has no business importing
 * `gameEngines` itself (that would hand it `apply`/`createInitialState`
 * along with everything else). Today this returns exactly one entry
 * (board-question); adding a second real engine to `gameEngines` is the
 * entire change needed for it to show up here too — nothing in this
 * function name a specific game.
 */
export function listGameDefinitions(): GameDefinition[] {
  return Object.values(gameEngines).map((engine) => ({
    id: engine.id,
    label: engine.label,
    description: engine.description,
    meta: engine.meta,
    hasContentStudio: engine.hasContentStudio,
  }));
}
