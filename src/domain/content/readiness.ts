/**
 * "Is this board actually ready to play" — the one shared, pure, testable
 * definition, per product brief ("Show Preparation" pass, section 5): a
 * question/category/playlist is complete or it isn't, computed the same
 * way everywhere (the Board Editor's per-cell glyph, the Question
 * Editor's mini nav, the Library card, the Host lobby's "Choose your
 * content" — see AGENTS.md "Folder boundaries": this is domain logic, so
 * it lives here, not duplicated across React components).
 *
 * Deliberately simple, matching Jeopardy's actual shape today — not a
 * generic "content validation framework." A question is complete iff:
 *   - its value is a positive whole number (matches boardQuestionSchema's
 *     `z.number().int().positive()` in src/domain/game/boardQuestion —
 *     the Game Kernel's own requirement, restated here since content is
 *     authored before any engine ever sees it);
 *   - its prompt is non-empty (after trimming);
 *   - its answer is non-empty (after trimming).
 * No fixed per-category question count — Jeopardy doesn't require
 * exactly N questions per category (see PlaylistQuestion.value's schema
 * comment on not hardcoding 100/200/300/400), so there's no canonical
 * "should have N questions" to compare against. There IS a floor,
 * though: a category with ZERO questions is a column on the board with
 * nothing to click — not a lighter version of ready, a real reason a
 * Host shouldn't be told "you can go live." READY means exactly what the
 * product brief says it should: "I can start this Jeopardy right now
 * with no surprise" — an empty category is a guaranteed surprise the
 * first time someone's eyes land on that column live.
 */

export interface QuestionCompletenessInput {
  value: number;
  prompt: string;
  answer: string;
}

export type QuestionIssue = "INVALID_VALUE" | "MISSING_PROMPT" | "MISSING_ANSWER";

const ISSUE_LABEL: Record<QuestionIssue, string> = {
  INVALID_VALUE: "Invalid value",
  MISSING_PROMPT: "Missing question text",
  MISSING_ANSWER: "Missing answer",
};

export function describeQuestionIssue(issue: QuestionIssue): string {
  return ISSUE_LABEL[issue];
}

/** The specific reasons (if any) a question isn't complete — empty array means complete. Order is stable (value, then prompt, then answer) so callers can render it deterministically. */
export function getQuestionIssues(question: QuestionCompletenessInput): QuestionIssue[] {
  const issues: QuestionIssue[] = [];
  if (!Number.isInteger(question.value) || question.value <= 0) issues.push("INVALID_VALUE");
  if (!question.prompt.trim()) issues.push("MISSING_PROMPT");
  if (!question.answer.trim()) issues.push("MISSING_ANSWER");
  return issues;
}

export function isQuestionComplete(question: QuestionCompletenessInput): boolean {
  return getQuestionIssues(question).length === 0;
}

export interface QuestionReadinessInput extends QuestionCompletenessInput {
  id: string;
  categoryId: string;
}

export interface CategoryReadinessInput {
  id: string;
  name: string;
  questions: QuestionReadinessInput[];
}

/** One flagged question, for callers that want to point the Host at exactly what's wrong (the Board Editor's per-cell glyph, the Question Editor's mini nav, the /host "Review board" banner). */
export interface FlaggedQuestion {
  questionId: string;
  categoryId: string;
  categoryName: string;
  value: number;
  issues: QuestionIssue[];
}

/** A category with zero questions — a real reason the board isn't ready (see this file's top comment), distinct from a question that exists but is missing a field. */
export interface EmptyCategory {
  categoryId: string;
  categoryName: string;
}

/**
 * The single next thing a Host should fix, in board reading order
 * (category by category, top-to-bottom within each) — what "go to the
 * first problem" (product brief "Show Preparation" section 3) actually
 * jumps to. `null` once the board is ready. Computed here, alongside the
 * rest of readiness, instead of a caller re-deriving "which one is
 * first" from `incompleteQuestions`/`emptyCategories` itself — there's
 * exactly one reading order and this is the one place it's defined.
 */
export type ReadinessProblem =
  | { type: "empty_category"; categoryId: string; categoryName: string }
  | { type: "question"; questionId: string; categoryId: string; categoryName: string };

export type PlaylistReadinessStatus = "empty" | "incomplete" | "ready";

export interface PlaylistReadiness {
  status: PlaylistReadinessStatus;
  /** True only for `status === "ready"` — a plain boolean for callers that just want a yes/no ("can I stop worrying and hit Start"). */
  ready: boolean;
  categoryCount: number;
  questionCount: number;
  completeQuestionCount: number;
  incompleteQuestions: FlaggedQuestion[];
  emptyCategories: EmptyCategory[];
  firstProblem: ReadinessProblem | null;
  /** One human-readable line summarizing the state — "Add a category to get started." / "1 category is empty." / "3 questions need attention." / "Ready to play." — built from the SAME data as the rest of this object, not a separately-maintained copy. */
  summary: string;
}

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** "category" doesn't pluralize by just appending "s" — its own tiny irregular case, not worth a general inflector for one word. */
function pluralizeCategories(count: number): string {
  return `${count} ${count === 1 ? "category" : "categories"}`;
}

function buildSummary(status: PlaylistReadinessStatus, emptyCategories: EmptyCategory[], incompleteQuestions: FlaggedQuestion[]): string {
  if (status === "empty") return "Add a category to get started.";
  if (status === "ready") return "Ready to play.";

  // Two genuinely different kinds of problem (a column with nothing in
  // it vs. a cell that's there but not filled in) — say both plainly
  // when both exist, rather than picking one to report and burying the
  // other. Deliberately a COUNT, not a breakdown by issue kind (missing
  // prompt vs. missing answer vs. invalid value) — that level of detail
  // belongs at the point of actually fixing a question (the cell's own
  // tooltip, the editor's own validation error), not in the one-line
  // headline whose job is "how many things, go look."
  const parts: string[] = [];
  if (emptyCategories.length > 0) {
    parts.push(`${pluralizeCategories(emptyCategories.length)} empty`);
  }
  if (incompleteQuestions.length > 0) {
    parts.push(`${pluralize(incompleteQuestions.length, "question")} need${incompleteQuestions.length === 1 ? "s" : ""} attention`);
  }
  return `${parts.join("; ")}.`;
}

/**
 * The one place a Playlist's readiness gets computed — every caller
 * (server: content.playlist.list/get, client: instant local recompute in
 * the Board/Question editors) calls this same function over the same
 * shape, so "is this board ready" can never drift between what the
 * Library card shows and what the Host lobby's content picker shows.
 */
export function getPlaylistReadiness(categories: CategoryReadinessInput[]): PlaylistReadiness {
  const categoryCount = categories.length;
  const questionCount = categories.reduce((sum, c) => sum + c.questions.length, 0);

  // EMPTY means "nothing built yet at all" — no category exists to even
  // judge. A playlist with categories but zero questions in ALL of them
  // is NOT this state: it's "incomplete" (every one of those categories
  // is flagged below), because the Host has already started — the next
  // thing to do is fill a category in, not "add a category" from
  // scratch.
  if (categoryCount === 0) {
    return {
      status: "empty",
      ready: false,
      categoryCount: 0,
      questionCount: 0,
      completeQuestionCount: 0,
      incompleteQuestions: [],
      emptyCategories: [],
      firstProblem: null,
      summary: buildSummary("empty", [], []),
    };
  }

  const incompleteQuestions: FlaggedQuestion[] = [];
  const emptyCategories: EmptyCategory[] = [];
  let completeQuestionCount = 0;
  let firstProblem: ReadinessProblem | null = null;

  for (const category of categories) {
    if (category.questions.length === 0) {
      emptyCategories.push({ categoryId: category.id, categoryName: category.name });
      firstProblem ??= { type: "empty_category", categoryId: category.id, categoryName: category.name };
      continue;
    }
    for (const question of category.questions) {
      const issues = getQuestionIssues(question);
      if (issues.length === 0) {
        completeQuestionCount += 1;
        continue;
      }
      incompleteQuestions.push({ questionId: question.id, categoryId: category.id, categoryName: category.name, value: question.value, issues });
      firstProblem ??= { type: "question", questionId: question.id, categoryId: category.id, categoryName: category.name };
    }
  }

  const status: PlaylistReadinessStatus = incompleteQuestions.length === 0 && emptyCategories.length === 0 ? "ready" : "incomplete";
  return {
    status,
    ready: status === "ready",
    categoryCount,
    questionCount,
    completeQuestionCount,
    incompleteQuestions,
    emptyCategories,
    firstProblem,
    summary: buildSummary(status, emptyCategories, incompleteQuestions),
  };
}
