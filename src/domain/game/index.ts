export type { GameStatus, KernelErrorCode, GameError, EngineOk, EngineErr, EngineResult, GameEngine } from "./kernel";
export { ok, err } from "./kernel";

export type { Scoreboard } from "./scoring";
export { initialScoreboard, addScore, checkFirstToN, leadingTeam } from "./scoring";

export type { ScoreChangedEvent, GameFinishedEvent } from "./events";
export { scoreChangedEvent, gameFinishedEvent } from "./events";

export { computeDeadline, isExpired, remainingMs } from "./timer";

export { gameEngines, getGameEngine } from "./registry";
export type { GameKey } from "./registry";

export { gameRoomName } from "./rooms";
export type { GameAudience } from "./rooms";
