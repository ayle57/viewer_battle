import type { SteamRatingsConfig, SteamRatingsRoundConfig } from "@/domain/game/steamRatings";

/**
 * Pure input shape for the mapping below — deliberately NOT Prisma's
 * generated row type (src/domain must stay Prisma-free, see AGENTS.md
 * "Folder boundaries"). src/server/db/contentSteam.ts shapes its Prisma
 * query results into this before calling in here. Same reasoning as
 * musicMapping.ts's ContentTrackInput.
 */
export interface ContentSteamGameInput {
  id: string;
  title: string | null;
  imageUrl: string | null;
  ratings: string[];
}

/**
 * Turns a prepared, already-ready playlist's games into exactly the
 * config shape SteamRatingsEngine.createInitialState expects — the ONE
 * place Content Studio's Steam Ratings data crosses into Game Kernel
 * data, same role as musicMapping.ts's playlistToMusicConfig plays for
 * Music. Pure and total over READY input: every game here is assumed
 * already readiness-checked (getSteamRatingsPlaylistReadiness(...).ready
 * — the caller's job, same as playlistToMusicConfig's caller checks
 * getMusicPlaylistReadiness first) — `title`/`imageUrl` being non-null
 * and `ratings` being non-empty is what that check already guaranteed,
 * so this throws (rather than silently coercing) if handed an incomplete
 * game, the same "genuinely shouldn't happen, fail loud if it does"
 * posture steamRatingsConfigSchema's own `.parse()` has inside
 * SteamRatingsEngine.createInitialState.
 *
 * Same "snapshot, not a live reference" guarantee as every other mapping
 * in this app — the RESULT of this function is what gets copied into
 * SessionGame.internalState; nothing downstream keeps a pointer back to
 * the Playlist/PlaylistSteamGame rows, so an edit made after this call
 * can never reach a game already started.
 */
export function playlistToSteamRatingsConfig(games: ContentSteamGameInput[]): SteamRatingsConfig {
  const rounds: SteamRatingsRoundConfig[] = games.map((game) => {
    if (!game.title || !game.imageUrl || game.ratings.length === 0) {
      throw new Error(`Game "${game.id}" is not complete (missing title, cover image, or ratings) — check readiness before mapping.`);
    }
    return {
      id: game.id,
      title: game.title,
      imageUrl: game.imageUrl,
      ratings: game.ratings,
    };
  });
  return { rounds };
}
