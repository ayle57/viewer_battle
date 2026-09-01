/**
 * "Is this Guess-the-Price playlist actually ready to play" — the
 * Guess-the-Price counterpart to steamReadiness.ts's
 * `getSteamRatingsPlaylistReadiness`, computed the same way (one pure,
 * testable, server+client-shared function) but over this game's own
 * content shape: a flat list of ITEMS, each complete iff it has a
 * title, a photo, AND a price (src/domain/game/guessThePrice/types.ts's
 * priceRoundSchema — `price` required, `marginPercent` genuinely
 * optional and never part of completeness). Same status vocabulary
 * (`empty`/`incomplete`/`ready`) and the same shape of guarantee: every
 * surface that needs to know "can the Host start this" (the item list,
 * the Host lobby's content picker, game.start's server-side refusal)
 * calls this one function, never re-derives it.
 *
 * No fixed "must have exactly N items" floor beyond "at least one
 * complete item" — same posture as Steam Ratings' own readiness:
 * GuessThePriceEngine is correct for any positive round count,
 * gracefully ending the game (leading score wins, "TIE" if level) if
 * fewer than GUESS_THE_PRICE_WIN_THRESHOLD items are configured. A real
 * show would configure many more — that's a product recommendation, not
 * a rule this function enforces.
 */

export interface ItemCompletenessInput {
  title: string | null;
  imageUrl: string | null;
  price: number | null;
}

export function isPriceItemComplete(item: ItemCompletenessInput): boolean {
  return Boolean(item.title) && Boolean(item.imageUrl) && item.price !== null;
}

export interface ItemReadinessInput extends ItemCompletenessInput {
  id: string;
}

/** One incomplete item, for callers that want to point the Host at exactly what's missing (the item list's own status glyph — same spirit as steamReadiness.ts's IncompleteSteamGame). */
export interface IncompletePriceItem {
  itemId: string;
  missingTitle: boolean;
  missingImage: boolean;
  missingPrice: boolean;
}

export type GuessThePricePlaylistReadinessStatus = "empty" | "incomplete" | "ready";

export interface GuessThePricePlaylistReadiness {
  status: GuessThePricePlaylistReadinessStatus;
  ready: boolean;
  itemCount: number;
  completeItemCount: number;
  incompleteItems: IncompletePriceItem[];
  /** The first incomplete item's id, in list order — `null` once ready. Same "go straight to the first problem" purpose as steamReadiness.ts's `firstProblemGameId`. */
  firstProblemItemId: string | null;
  /** One human-readable line, built from the SAME data as the rest of this object. */
  summary: string;
}

function buildSummary(status: GuessThePricePlaylistReadinessStatus, incompleteItems: IncompletePriceItem[]): string {
  if (status === "empty") return "Add an item to get started.";
  if (status === "ready") return "Ready to play.";
  const count = incompleteItems.length;
  return `${count} item${count === 1 ? "" : "s"} ${count === 1 ? "is" : "are"} missing a title, photo, or price.`;
}

/**
 * The one place a Guess the Price Playlist's readiness gets computed —
 * every caller (server: contentPriceRouter's list/get, game.start's
 * refusal check; client: instant local recompute in the item editor)
 * calls this same function over the same shape.
 */
export function getGuessThePricePlaylistReadiness(items: ItemReadinessInput[]): GuessThePricePlaylistReadiness {
  if (items.length === 0) {
    return {
      status: "empty",
      ready: false,
      itemCount: 0,
      completeItemCount: 0,
      incompleteItems: [],
      firstProblemItemId: null,
      summary: buildSummary("empty", []),
    };
  }

  const incompleteItems: IncompletePriceItem[] = [];
  let completeItemCount = 0;
  for (const item of items) {
    const missingTitle = !item.title;
    const missingImage = !item.imageUrl;
    const missingPrice = item.price === null;
    if (!missingTitle && !missingImage && !missingPrice) {
      completeItemCount += 1;
      continue;
    }
    incompleteItems.push({ itemId: item.id, missingTitle, missingImage, missingPrice });
  }

  const status: GuessThePricePlaylistReadinessStatus = incompleteItems.length === 0 ? "ready" : "incomplete";
  return {
    status,
    ready: status === "ready",
    itemCount: items.length,
    completeItemCount,
    incompleteItems,
    firstProblemItemId: incompleteItems[0]?.itemId ?? null,
    summary: buildSummary(status, incompleteItems),
  };
}
