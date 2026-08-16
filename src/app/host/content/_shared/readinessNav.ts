import type { ReadinessProblem } from "@/domain/content";

/**
 * Encodes a `ReadinessProblem` (src/domain/content/readiness.ts) into the
 * `?issue=` query param the playlist editor page (playlists/[id]/
 * page.tsx) reads once on mount to jump straight to it and open the
 * Question Editor already pointed at the right spot — the one shared
 * encoding so every place that links to "go fix this" (the Host lobby's
 * "Review board", the playlist editor's own "Fix first issue" button)
 * builds the exact same URL. `q:`/`c:` rather than reusing the bare id
 * because a question id and a category id are both opaque cuids —
 * nothing else distinguishes "open this question" from "start a new
 * question in this category" without the prefix.
 */
export function issueQueryParam(problem: ReadinessProblem): string {
  return problem.type === "question" ? `q:${problem.questionId}` : `c:${problem.categoryId}`;
}

export type IssueTarget = { type: "edit"; questionId: string } | { type: "create"; categoryId: string };

export function parseIssueQueryParam(value: string | null): IssueTarget | null {
  if (!value) return null;
  if (value.startsWith("q:")) return { type: "edit", questionId: value.slice(2) };
  if (value.startsWith("c:")) return { type: "create", categoryId: value.slice(2) };
  return null;
}

/** Same shape as `IssueTarget` — a `ReadinessProblem` straight from the domain, for a caller (the playlist editor's own "Fix first issue" button) that's opening the Question Editor in-page rather than building a URL. */
export function problemToTarget(problem: ReadinessProblem): IssueTarget {
  return problem.type === "question" ? { type: "edit", questionId: problem.questionId } : { type: "create", categoryId: problem.categoryId };
}
