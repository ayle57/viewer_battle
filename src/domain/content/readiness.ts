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
 * No "category is complete" concept beyond "has at least one question" —
 * Jeopardy doesn't require a fixed question count per category (see
 * PlaylistQuestion.value's schema comment on not hardcoding 100/200/300/
 * 400), so there's no canonical "should have N questions" to compare
 * against.
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

export type PlaylistReadinessStatus = "empty" | "incomplete" | "ready";

export interface PlaylistReadiness {
  status: PlaylistReadinessStatus;
  /** True only for `status === "ready"` — a plain boolean for callers that just want a yes/no ("can I stop worrying and hit Start"). */
  ready: boolean;
  categoryCount: number;
  questionCount: number;
  completeQuestionCount: number;
  incompleteQuestions: FlaggedQuestion[];
  /** One human-readable line summarizing the state — "Add categories and questions to get started." / "2 questions are missing answers." / "Ready to play." — built from the SAME data as the rest of this object, not a separately-maintained copy. */
  summary: string;
}

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function buildSummary(status: PlaylistReadinessStatus, incompleteQuestions: FlaggedQuestion[]): string {
  if (status === "empty") return "Add categories and questions to get started.";
  if (status === "ready") return "Ready to play.";

  // Group by issue kind so "3 questions are missing answers, 1 is missing question text"
  // reads as a real sentence instead of a raw list of ids.
  const missingAnswer = incompleteQuestions.filter((q) => q.issues.includes("MISSING_ANSWER")).length;
  const missingPrompt = incompleteQuestions.filter((q) => q.issues.includes("MISSING_PROMPT")).length;
  const invalidValue = incompleteQuestions.filter((q) => q.issues.includes("INVALID_VALUE")).length;

  const parts: string[] = [];
  if (missingAnswer > 0) parts.push(`${pluralize(missingAnswer, "question")} missing ${missingAnswer === 1 ? "an answer" : "answers"}`);
  if (missingPrompt > 0) parts.push(`${pluralize(missingPrompt, "question")} missing question text`);
  if (invalidValue > 0) parts.push(`${pluralize(invalidValue, "question")} with an invalid value`);

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
  const questionCount = categories.reduce((sum, c) => sum + c.questions.length, 0);
  const categoryCount = categories.length;

  if (categoryCount === 0 || questionCount === 0) {
    return {
      status: "empty",
      ready: false,
      categoryCount,
      questionCount,
      completeQuestionCount: 0,
      incompleteQuestions: [],
      summary: buildSummary("empty", []),
    };
  }

  const incompleteQuestions: FlaggedQuestion[] = [];
  let completeQuestionCount = 0;
  for (const category of categories) {
    for (const question of category.questions) {
      const issues = getQuestionIssues(question);
      if (issues.length === 0) {
        completeQuestionCount += 1;
      } else {
        incompleteQuestions.push({ questionId: question.id, categoryId: category.id, categoryName: category.name, value: question.value, issues });
      }
    }
  }

  const status: PlaylistReadinessStatus = incompleteQuestions.length === 0 ? "ready" : "incomplete";
  return {
    status,
    ready: status === "ready",
    categoryCount,
    questionCount,
    completeQuestionCount,
    incompleteQuestions,
    summary: buildSummary(status, incompleteQuestions),
  };
}
