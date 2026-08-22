export type { GameStatus, KernelErrorCode, GameError, EngineOk, EngineErr, EngineResult, GameEngine } from "./kernel";
export { ok, err } from "./kernel";

export type { Scoreboard } from "./scoring";
export { initialScoreboard, addScore, checkFirstToN, leadingTeam } from "./scoring";

export type { ScoreChangedEvent, GameFinishedEvent } from "./events";
export { scoreChangedEvent, gameFinishedEvent } from "./events";

export { computeDeadline, isExpired, remainingMs } from "./timer";

export { COUNTDOWN_DURATIONS_MS, startCountdownActionSchema, cancelCountdownActionSchema, countdownExpiredActionSchema } from "./countdown";
export type { CountdownDurationMs, CountdownStartedEvent, CountdownCancelledEvent } from "./countdown";

export { gameEngines, getGameEngine, listGameDefinitions, gameKeySchema } from "./registry";
export type { GameKey, GameDefinition } from "./registry";

export { gameRoomName, gameAudienceForRole } from "./rooms";
export type { GameAudience } from "./rooms";
