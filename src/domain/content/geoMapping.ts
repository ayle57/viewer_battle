import type { GeoGuessrConfig, GeoRoundConfig } from "@/domain/game/geoGuessr";

/**
 * Pure input shape for the mapping below — deliberately NOT Prisma's
 * generated row type (src/domain must stay Prisma-free, see AGENTS.md
 * "Folder boundaries"). src/server/db/contentGeo.ts shapes its Prisma
 * query results into this before calling in here. Same reasoning as
 * mapping.ts's ContentQuestionInput.
 */
export interface ContentRoundInput {
  id: string;
  imageUrl: string | null;
  question: string | null;
  targetX: number | null;
  targetY: number | null;
  title: string | null;
}

/**
 * Turns a prepared, already-ready playlist's rounds into exactly the
 * config shape GeoGuessrEngine.createInitialState expects — the ONE
 * place Content Studio's GeoGuessr data crosses into Game Kernel data,
 * same role as mapping.ts's playlistToBoardQuestionConfig plays for
 * Jeopardy. Pure and total over READY input: every round here is assumed
 * already readiness-checked (getGeoPlaylistReadiness(...).ready — the
 * caller's job, same as playlistToBoardQuestionConfig's caller checks
 * getPlaylistReadiness first) — `imageUrl`/`question`/`targetX`/`targetY`
 * being non-null is what that check already guaranteed, so this throws (rather
 * than silently coercing) if handed an incomplete round, the same
 * "genuinely shouldn't happen, fail loud if it does" posture
 * boardQuestionConfigSchema's own `.parse()` has inside
 * GeoGuessrEngine.createInitialState.
 *
 * Same "snapshot, not a live reference" guarantee as the Jeopardy mapping
 * — the RESULT of this function is what gets copied into
 * SessionGame.internalState; nothing downstream keeps a pointer back to
 * the Playlist/PlaylistRound rows, so an edit made after this call can
 * never reach a game already started.
 */
export function playlistToGeoGuessrConfig(rounds: ContentRoundInput[]): GeoGuessrConfig {
  const geoRounds: GeoRoundConfig[] = rounds.map((round) => {
    if (!round.imageUrl || !round.question || round.targetX === null || round.targetY === null) {
      throw new Error(`Round "${round.id}" is not complete (missing image, question, or target) — check readiness before mapping.`);
    }
    return {
      id: round.id,
      imageUrl: round.imageUrl,
      question: round.question,
      targetX: round.targetX,
      targetY: round.targetY,
      title: round.title ?? undefined,
    };
  });
  return { rounds: geoRounds };
}
