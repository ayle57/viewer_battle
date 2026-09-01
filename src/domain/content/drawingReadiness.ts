/**
 * "Is this Drawing playlist actually ready to play" — the Drawing
 * counterpart to geoReadiness.ts's `getGeoPlaylistReadiness`, computed
 * the same way (one pure, testable, server+client-shared function) but
 * over an even simpler content shape: a Drawing prompt only has ONE
 * thing that can be missing (its `text`) — `durationSeconds` always has
 * a DB default (30) so it's never genuinely absent, unlike GeoGuessr's
 * three independently-missing fields. Same status vocabulary
 * (`empty`/`incomplete`/`ready`) and the same shape of guarantee: every
 * surface that needs to know "can the Host start this" (the prompt list,
 * the Host lobby's content picker, game.start's server-side refusal)
 * calls this one function, never re-derives it.
 */

export interface PromptCompletenessInput {
  text: string | null;
}

export function isPromptComplete(prompt: PromptCompletenessInput): boolean {
  return Boolean(prompt.text && prompt.text.trim());
}

export interface PromptReadinessInput extends PromptCompletenessInput {
  id: string;
}

/** One incomplete prompt, for callers that want to point the Host at exactly what's missing (the prompt list's own status glyph — same spirit as geoReadiness.ts's IncompleteRound, simpler here since there's only one kind of problem). */
export interface IncompletePrompt {
  promptId: string;
}

export type DrawingPlaylistReadinessStatus = "empty" | "incomplete" | "ready";

export interface DrawingPlaylistReadiness {
  status: DrawingPlaylistReadinessStatus;
  ready: boolean;
  promptCount: number;
  completePromptCount: number;
  incompletePrompts: IncompletePrompt[];
  /** The first incomplete prompt's id, in list order — `null` once ready. Same "go straight to the first problem" purpose as geoReadiness.ts's `firstProblemRoundId`. */
  firstProblemPromptId: string | null;
  /** One human-readable line, built from the SAME data as the rest of this object. */
  summary: string;
}

function buildSummary(status: DrawingPlaylistReadinessStatus, incompletePrompts: IncompletePrompt[]): string {
  if (status === "empty") return "Add a prompt to get started.";
  if (status === "ready") return "Ready to play.";
  const count = incompletePrompts.length;
  return count === 1 ? "1 prompt is missing its word." : `${count} prompts are missing their word.`;
}

/**
 * The one place a Drawing Playlist's readiness gets computed — every
 * caller (server: contentDrawingRouter's list/get, game.start's refusal
 * check; client: instant local recompute in the prompt editor) calls
 * this same function over the same shape.
 */
export function getDrawingPlaylistReadiness(prompts: PromptReadinessInput[]): DrawingPlaylistReadiness {
  if (prompts.length === 0) {
    return {
      status: "empty",
      ready: false,
      promptCount: 0,
      completePromptCount: 0,
      incompletePrompts: [],
      firstProblemPromptId: null,
      summary: buildSummary("empty", []),
    };
  }

  const incompletePrompts: IncompletePrompt[] = [];
  let completePromptCount = 0;
  for (const prompt of prompts) {
    if (isPromptComplete(prompt)) {
      completePromptCount += 1;
      continue;
    }
    incompletePrompts.push({ promptId: prompt.id });
  }

  const status: DrawingPlaylistReadinessStatus = incompletePrompts.length === 0 ? "ready" : "incomplete";
  return {
    status,
    ready: status === "ready",
    promptCount: prompts.length,
    completePromptCount,
    incompletePrompts,
    firstProblemPromptId: incompletePrompts[0]?.promptId ?? null,
    summary: buildSummary(status, incompletePrompts),
  };
}
