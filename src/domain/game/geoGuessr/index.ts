export { geoGuessrEngine, createInitialState, apply, availableActions, GEO_WIN_THRESHOLD } from "./engine";
export { toPublicView } from "./view";
export { sampleGeoPlaylist } from "./fixtures";
export type {
  GeoGuessrState,
  GeoGuessrAction,
  GeoGuessrEvent,
  GeoGuessrConfig,
  GeoGuessrErrorCode,
  GeoGuessrPhase,
  GeoRound,
  GeoRoundConfig,
  GeoRoundResult,
  GeoGuess,
} from "./types";
export { geoGuessrActionSchema, geoGuessrConfigSchema, geoRoundSchema } from "./types";
// The countdown duration set/type is shared with BoardQuestionEngine now
// (src/domain/game/countdown.ts) — re-exported here too so existing
// callers of this module don't need a second import path.
export { COUNTDOWN_DURATIONS_MS } from "../countdown";
export type { CountdownDurationMs } from "../countdown";
