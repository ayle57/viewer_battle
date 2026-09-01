import type { DrawingConfig, DrawingPromptConfig } from "@/domain/game/drawing";

/**
 * Pure input shape for the mapping below — deliberately NOT Prisma's
 * generated row type (src/domain must stay Prisma-free, see AGENTS.md
 * "Folder boundaries"). src/server/db/contentDrawing.ts shapes its Prisma
 * query results into this before calling in here. Same reasoning as
 * geoMapping.ts's ContentRoundInput.
 */
export interface ContentPromptInput {
  id: string;
  text: string | null;
  durationSeconds: number;
}

/**
 * Turns a prepared, already-ready playlist's prompts into exactly the
 * config shape DrawingEngine.createInitialState expects — the ONE place
 * Content Studio's Drawing data crosses into Game Kernel data, same role
 * as geoMapping.ts's playlistToGeoGuessrConfig plays for GeoGuessr. Pure
 * and total over READY input: every prompt here is assumed already
 * readiness-checked (getDrawingPlaylistReadiness(...).ready — the
 * caller's job) — `text` being non-null/non-blank is what that check
 * already guaranteed, so this throws (rather than silently coercing) if
 * handed an incomplete prompt, the same "genuinely shouldn't happen, fail
 * loud if it does" posture drawingConfigSchema's own `.parse()` has
 * inside DrawingEngine.createInitialState.
 *
 * Same "snapshot, not a live reference" guarantee as both other
 * mappings — the RESULT of this function is what gets copied into
 * SessionGame.internalState (including each prompt's own
 * `durationSeconds`, the literal "set the timer per round" requirement);
 * nothing downstream keeps a pointer back to the Playlist/PlaylistPrompt
 * rows, so an edit made after this call can never reach a game already
 * started.
 */
export function playlistToDrawingConfig(prompts: ContentPromptInput[]): DrawingConfig {
  const drawingPrompts: DrawingPromptConfig[] = prompts.map((prompt) => {
    if (!prompt.text || !prompt.text.trim()) {
      throw new Error(`Prompt "${prompt.id}" is not complete (missing text) — check readiness before mapping.`);
    }
    return { id: prompt.id, text: prompt.text, durationSeconds: prompt.durationSeconds };
  });
  return { prompts: drawingPrompts };
}
