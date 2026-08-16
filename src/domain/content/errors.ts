/**
 * Explicit, UI-actionable business error codes for Content Studio
 * operations — same pattern as src/domain/session/errors.ts's
 * SessionError, deliberately not reused directly: content ownership
 * (ContentHost) and session/game identity (Participant) are two separate
 * identity systems on purpose (see prisma/schema.prisma's "Content
 * Studio" comment) and mixing their error codes would blur that boundary.
 * Thrown from src/server/db/content.ts and src/server/db/contentHost.ts,
 * mapped to a TRPCError at the edge by src/server/trpc/contentErrors.ts.
 */
export type ContentErrorCode =
  | "INVALID_HOST_PASSWORD"
  | "INVALID_CONTENT_TOKEN"
  | "PLAYLIST_NOT_FOUND"
  | "CATEGORY_NOT_FOUND"
  | "QUESTION_NOT_FOUND"
  | "CATEGORY_NOT_EMPTY"
  | "VALIDATION"
  | "PLAYLIST_NOT_READY";

const MESSAGES: Record<ContentErrorCode, string> = {
  INVALID_HOST_PASSWORD: "That password isn't correct.",
  INVALID_CONTENT_TOKEN: "This Content Studio session is invalid or has expired.",
  PLAYLIST_NOT_FOUND: "No playlist with that id exists.",
  CATEGORY_NOT_FOUND: "No category with that id exists.",
  QUESTION_NOT_FOUND: "No question with that id exists.",
  CATEGORY_NOT_EMPTY: "This category still has questions — confirm before deleting.",
  VALIDATION: "That value isn't valid.",
  // Default message only — src/server/trpc/router.ts's game.start always
  // supplies a specific one built from the playlist's own
  // PlaylistReadiness.summary (src/domain/content/readiness.ts), so the
  // Host sees exactly which questions are missing what, not this generic
  // fallback.
  PLAYLIST_NOT_READY: "This board isn't ready to play yet.",
};

export class ContentError extends Error {
  readonly code: ContentErrorCode;

  constructor(code: ContentErrorCode, message?: string) {
    super(message ?? MESSAGES[code]);
    this.name = "ContentError";
    this.code = code;
  }
}
