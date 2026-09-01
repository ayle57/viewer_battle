/**
 * "Is this Guess-the-Game playlist actually ready to play" — the Steam
 * Ratings counterpart to musicReadiness.ts's `getMusicPlaylistReadiness`,
 * computed the same way (one pure, testable, server+client-shared
 * function) but over Steam Ratings' own content shape: a flat list of
 * GAMES, each complete iff it has a title, a cover image, AND at least
 * one Steam rating (src/domain/game/steamRatings/types.ts's
 * steamRatingsRoundSchema — `ratings.min(1)`). Same status vocabulary
 * (`empty`/`incomplete`/`ready`) and the same shape of guarantee: every
 * surface that needs to know "can the Host start this" (the game list,
 * the Host lobby's content picker, game.start's server-side refusal)
 * calls this one function, never re-derives it.
 *
 * No fixed "must have exactly N games" floor beyond "at least one
 * complete game" — same posture as Music's own readiness:
 * SteamRatingsEngine is correct for any positive round count, gracefully
 * ending the game (leading score wins, "TIE" if level) if fewer than
 * STEAM_RATINGS_WIN_THRESHOLD games are configured. A real show would
 * configure many more — that's a product recommendation, not a rule this
 * function enforces.
 */

export interface GameCompletenessInput {
  title: string | null;
  imageUrl: string | null;
  ratings: string[];
}

export function isGameComplete(game: GameCompletenessInput): boolean {
  return Boolean(game.title) && Boolean(game.imageUrl) && game.ratings.length > 0;
}

export interface GameReadinessInput extends GameCompletenessInput {
  id: string;
}

/** One incomplete game, for callers that want to point the Host at exactly what's missing (the game list's own status glyph — same spirit as musicReadiness.ts's IncompleteTrack). */
export interface IncompleteSteamGame {
  gameId: string;
  missingTitle: boolean;
  missingImage: boolean;
  missingRatings: boolean;
}

export type SteamRatingsPlaylistReadinessStatus = "empty" | "incomplete" | "ready";

export interface SteamRatingsPlaylistReadiness {
  status: SteamRatingsPlaylistReadinessStatus;
  ready: boolean;
  gameCount: number;
  completeGameCount: number;
  incompleteGames: IncompleteSteamGame[];
  /** The first incomplete game's id, in list order — `null` once ready. Same "go straight to the first problem" purpose as musicReadiness.ts's `firstProblemTrackId`. */
  firstProblemGameId: string | null;
  /** One human-readable line, built from the SAME data as the rest of this object. */
  summary: string;
}

function buildSummary(status: SteamRatingsPlaylistReadinessStatus, incompleteGames: IncompleteSteamGame[]): string {
  if (status === "empty") return "Add a game to get started.";
  if (status === "ready") return "Ready to play.";
  const count = incompleteGames.length;
  return `${count} game${count === 1 ? "" : "s"} ${count === 1 ? "is" : "are"} missing a title, cover, or at least one rating.`;
}

/**
 * The one place a Steam Ratings Playlist's readiness gets computed —
 * every caller (server: contentSteamRouter's list/get, game.start's
 * refusal check; client: instant local recompute in the game editor)
 * calls this same function over the same shape.
 */
export function getSteamRatingsPlaylistReadiness(games: GameReadinessInput[]): SteamRatingsPlaylistReadiness {
  if (games.length === 0) {
    return {
      status: "empty",
      ready: false,
      gameCount: 0,
      completeGameCount: 0,
      incompleteGames: [],
      firstProblemGameId: null,
      summary: buildSummary("empty", []),
    };
  }

  const incompleteGames: IncompleteSteamGame[] = [];
  let completeGameCount = 0;
  for (const game of games) {
    const missingTitle = !game.title;
    const missingImage = !game.imageUrl;
    const missingRatings = game.ratings.length === 0;
    if (!missingTitle && !missingImage && !missingRatings) {
      completeGameCount += 1;
      continue;
    }
    incompleteGames.push({ gameId: game.id, missingTitle, missingImage, missingRatings });
  }

  const status: SteamRatingsPlaylistReadinessStatus = incompleteGames.length === 0 ? "ready" : "incomplete";
  return {
    status,
    ready: status === "ready",
    gameCount: games.length,
    completeGameCount,
    incompleteGames,
    firstProblemGameId: incompleteGames[0]?.gameId ?? null,
    summary: buildSummary(status, incompleteGames),
  };
}
