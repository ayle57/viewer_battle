import type { GuessThePriceConfig, PriceRoundConfig } from "@/domain/game/guessThePrice";

/**
 * Pure input shape for the mapping below — deliberately NOT Prisma's
 * generated row type (src/domain must stay Prisma-free, see AGENTS.md
 * "Folder boundaries"). src/server/db/contentPrice.ts shapes its Prisma
 * query results into this before calling in here. Same reasoning as
 * steamMapping.ts's ContentSteamGameInput.
 */
export interface ContentPriceItemInput {
  id: string;
  title: string | null;
  imageUrl: string | null;
  price: number | null;
  marginPercent: number | null;
}

/**
 * Turns a prepared, already-ready playlist's items into exactly the
 * config shape GuessThePriceEngine.createInitialState expects — the ONE
 * place Content Studio's Guess the Price data crosses into Game Kernel
 * data, same role as steamMapping.ts's playlistToSteamRatingsConfig
 * plays for Steam Ratings. Pure and total over READY input: every item
 * here is assumed already readiness-checked
 * (getGuessThePricePlaylistReadiness(...).ready — the caller's job, same
 * as playlistToSteamRatingsConfig's caller checks
 * getSteamRatingsPlaylistReadiness first) — `title`/`imageUrl`/`price`
 * being non-null is what that check already guaranteed, so this throws
 * (rather than silently coercing) if handed an incomplete item, the
 * same "genuinely shouldn't happen, fail loud if it does" posture
 * guessThePriceConfigSchema's own `.parse()` has inside
 * GuessThePriceEngine.createInitialState. `marginPercent` stays
 * genuinely optional (`null` -> omitted) — see prisma/schema.prisma's
 * own doc comment on PlaylistPriceItem.
 *
 * Same "snapshot, not a live reference" guarantee as every other mapping
 * in this app — the RESULT of this function is what gets copied into
 * SessionGame.internalState; nothing downstream keeps a pointer back to
 * the Playlist/PlaylistPriceItem rows, so an edit made after this call
 * can never reach a game already started.
 */
export function playlistToGuessThePriceConfig(items: ContentPriceItemInput[]): GuessThePriceConfig {
  const rounds: PriceRoundConfig[] = items.map((item) => {
    if (!item.title || !item.imageUrl || item.price === null) {
      throw new Error(`Item "${item.id}" is not complete (missing title, photo, or price) — check readiness before mapping.`);
    }
    return {
      id: item.id,
      title: item.title,
      imageUrl: item.imageUrl,
      price: item.price,
      ...(item.marginPercent !== null ? { marginPercent: item.marginPercent } : {}),
    };
  });
  return { rounds };
}
