/**
 * "Is this GeoGuessr playlist actually ready to play" — the GeoGuessr
 * counterpart to readiness.ts's `getPlaylistReadiness`, computed the same
 * way (one pure, testable, server+client-shared function) but over a
 * genuinely different content shape: GeoGuessr has flat ROUNDS, not a
 * category/question tree, so this is a parallel function with its own
 * honest field names — not `getPlaylistReadiness` itself forced to
 * pretend a round is a "question" or that there's a "category" concept
 * here (there isn't). Same status vocabulary (`empty`/`incomplete`/
 * `ready`) and the same shape of guarantee: every surface that needs to
 * know "can the Host start this" (the round list, the Host lobby's
 * content picker, game.start's server-side refusal) calls this one
 * function, never re-derives it.
 *
 * A round is complete iff it has an image, a target, AND a question
 * (the player-facing prompt — "Where is the docking bay?", see
 * PlaylistRound.question's own doc comment) — matches PlaylistRound's
 * nullable columns (prisma/schema.prisma) and geoRoundSchema's
 * requirement (src/domain/game/geoGuessr/types.ts) that every round
 * handed to the engine has all three. No fixed "must have exactly N
 * rounds" floor beyond "at least one complete round" — GeoGuessrEngine
 * (src/domain/game/geoGuessr/engine.ts) is correct for any positive round
 * count, gracefully ending the game (leading score wins, "TIE" if level)
 * if fewer than GEO_WIN_THRESHOLD rounds are configured; a real show
 * would configure more (the product's own example: 12), but that's a
 * product recommendation, not a rule this function enforces.
 */

export interface RoundCompletenessInput {
  imageUrl: string | null;
  question: string | null;
  targetX: number | null;
  targetY: number | null;
}

export function isRoundComplete(round: RoundCompletenessInput): boolean {
  return Boolean(round.imageUrl) && Boolean(round.question) && round.targetX !== null && round.targetY !== null;
}

export interface RoundReadinessInput extends RoundCompletenessInput {
  id: string;
  title: string | null;
}

/** One incomplete round, for callers that want to point the Host at exactly what's missing (the round list's own status glyph, a future "fix first issue" jump — same spirit as readiness.ts's FlaggedQuestion). */
export interface IncompleteRound {
  roundId: string;
  missingImage: boolean;
  missingQuestion: boolean;
  missingTarget: boolean;
}

export type GeoPlaylistReadinessStatus = "empty" | "incomplete" | "ready";

export interface GeoPlaylistReadiness {
  status: GeoPlaylistReadinessStatus;
  ready: boolean;
  roundCount: number;
  completeRoundCount: number;
  incompleteRounds: IncompleteRound[];
  /** The first incomplete round's id, in list order — `null` once ready. Same "go straight to the first problem" purpose as readiness.ts's `firstProblem`, simpler here because there's only one KIND of problem (an incomplete round), not two. */
  firstProblemRoundId: string | null;
  /** One human-readable line, built from the SAME data as the rest of this object — "Add a round to get started." / "3 rounds are missing an image, question, or target." / "Ready to play." */
  summary: string;
}

function buildSummary(status: GeoPlaylistReadinessStatus, incompleteRounds: IncompleteRound[]): string {
  if (status === "empty") return "Add a round to get started.";
  if (status === "ready") return "Ready to play.";
  const count = incompleteRounds.length;
  return `${count} round${count === 1 ? "" : "s"} ${count === 1 ? "is" : "are"} missing an image, question, or target.`;
}

/**
 * The one place a GeoGuessr Playlist's readiness gets computed — every
 * caller (server: contentGeoRouter's list/get, game.start's refusal
 * check; client: instant local recompute in the round editor) calls this
 * same function over the same shape.
 */
export function getGeoPlaylistReadiness(rounds: RoundReadinessInput[]): GeoPlaylistReadiness {
  if (rounds.length === 0) {
    return {
      status: "empty",
      ready: false,
      roundCount: 0,
      completeRoundCount: 0,
      incompleteRounds: [],
      firstProblemRoundId: null,
      summary: buildSummary("empty", []),
    };
  }

  const incompleteRounds: IncompleteRound[] = [];
  let completeRoundCount = 0;
  for (const round of rounds) {
    const missingImage = !round.imageUrl;
    const missingQuestion = !round.question;
    const missingTarget = round.targetX === null || round.targetY === null;
    if (!missingImage && !missingQuestion && !missingTarget) {
      completeRoundCount += 1;
      continue;
    }
    incompleteRounds.push({ roundId: round.id, missingImage, missingQuestion, missingTarget });
  }

  const status: GeoPlaylistReadinessStatus = incompleteRounds.length === 0 ? "ready" : "incomplete";
  return {
    status,
    ready: status === "ready",
    roundCount: rounds.length,
    completeRoundCount,
    incompleteRounds,
    firstProblemRoundId: incompleteRounds[0]?.roundId ?? null,
    summary: buildSummary(status, incompleteRounds),
  };
}
