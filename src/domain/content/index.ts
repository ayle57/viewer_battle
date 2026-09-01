export { ContentError } from "./errors";
export type { ContentErrorCode } from "./errors";

export { playlistToBoardQuestionConfig } from "./mapping";
export type { ContentCategoryInput, ContentQuestionInput } from "./mapping";

export { isQuestionComplete, getQuestionIssues, describeQuestionIssue, getPlaylistReadiness } from "./readiness";
export type {
  QuestionCompletenessInput,
  QuestionIssue,
  QuestionReadinessInput,
  CategoryReadinessInput,
  FlaggedQuestion,
  EmptyCategory,
  ReadinessProblem,
  PlaylistReadinessStatus,
  PlaylistReadiness,
} from "./readiness";

export { isRoundComplete, getGeoPlaylistReadiness } from "./geoReadiness";
export type {
  RoundCompletenessInput,
  RoundReadinessInput,
  IncompleteRound,
  GeoPlaylistReadinessStatus,
  GeoPlaylistReadiness,
} from "./geoReadiness";

export { playlistToGeoGuessrConfig } from "./geoMapping";
export type { ContentRoundInput } from "./geoMapping";

export { isPromptComplete, getDrawingPlaylistReadiness } from "./drawingReadiness";
export type {
  PromptCompletenessInput,
  PromptReadinessInput,
  IncompletePrompt,
  DrawingPlaylistReadinessStatus,
  DrawingPlaylistReadiness,
} from "./drawingReadiness";

export { playlistToDrawingConfig } from "./drawingMapping";
export type { ContentPromptInput } from "./drawingMapping";

export { isTrackComplete, getMusicPlaylistReadiness } from "./musicReadiness";
export type {
  TrackCompletenessInput,
  TrackReadinessInput,
  IncompleteTrack,
  MusicPlaylistReadinessStatus,
  MusicPlaylistReadiness,
} from "./musicReadiness";

export { playlistToMusicConfig } from "./musicMapping";
export type { ContentTrackInput } from "./musicMapping";

export { isGameComplete, getSteamRatingsPlaylistReadiness } from "./steamReadiness";
export type {
  GameCompletenessInput,
  GameReadinessInput,
  IncompleteSteamGame,
  SteamRatingsPlaylistReadinessStatus,
  SteamRatingsPlaylistReadiness,
} from "./steamReadiness";

export { playlistToSteamRatingsConfig } from "./steamMapping";
export type { ContentSteamGameInput } from "./steamMapping";

export { isPriceItemComplete, getGuessThePricePlaylistReadiness } from "./priceReadiness";
export type {
  ItemCompletenessInput,
  ItemReadinessInput,
  IncompletePriceItem,
  GuessThePricePlaylistReadinessStatus,
  GuessThePricePlaylistReadiness,
} from "./priceReadiness";

export { playlistToGuessThePriceConfig } from "./priceMapping";
export type { ContentPriceItemInput } from "./priceMapping";
