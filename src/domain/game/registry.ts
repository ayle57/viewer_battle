import { z } from "zod";
import { boardQuestionEngine } from "./boardQuestion";
import { geoGuessrEngine } from "./geoGuessr";
import { drawingEngine } from "./drawing";
import { musicEngine } from "./music";
import { steamRatingsEngine } from "./steamRatings";
import { guessThePriceEngine } from "./guessThePrice";
import { pointingSystemEngine } from "./pointingSystem";
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
  [geoGuessrEngine.id]: geoGuessrEngine,
  [drawingEngine.id]: drawingEngine,
  [musicEngine.id]: musicEngine,
  [steamRatingsEngine.id]: steamRatingsEngine,
  [guessThePriceEngine.id]: guessThePriceEngine,
  [pointingSystemEngine.id]: pointingSystemEngine,
};

export type GameKey = keyof typeof gameEngines;

export function getGameEngine(gameKey: string) {
  return gameEngines[gameKey];
}

/**
 * A zod schema for "any registered engine id," derived from `gameEngines`
 * itself instead of hand-listed literals — the ONE place a tRPC input
 * schema needs to accept a `gameKey` (router.ts's `game.start`,
 * contentRouter.ts's playlist procedures) imports this rather than each
 * maintaining its own `z.literal(...)`/`z.enum([...])` that could drift
 * out of sync with the registry as engines are added. `Object.keys` is
 * evaluated once, at module load, after `gameEngines` above is already
 * fully populated — safe because both live in this same module's
 * top-to-bottom initialization order.
 */
export const gameKeySchema = z.enum(Object.keys(gameEngines) as [string, ...string[]]);

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
