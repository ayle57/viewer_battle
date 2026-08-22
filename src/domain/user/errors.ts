/**
 * Explicit, UI-actionable business error codes for real `User` account
 * operations — same pattern as src/domain/session/errors.ts's
 * SessionError and src/domain/content/errors.ts's ContentError,
 * deliberately its own type rather than reused: a User account is a
 * THIRD identity system (see prisma/schema.prisma's own User doc
 * comment), and mixing its error codes into either of the other two
 * would blur that boundary the same way ContentError already avoids
 * blurring into SessionError. Thrown from src/server/db/user.ts, mapped
 * to a TRPCError at the edge by src/server/trpc/userErrors.ts.
 */
export type UserErrorCode =
  | "USERNAME_TAKEN"
  | "INVALID_CREDENTIALS"
  | "INVALID_TOKEN"
  | "USER_NOT_FOUND"
  | "VALIDATION"
  | "NOT_ADMIN"
  | "CANNOT_DELETE_ADMIN";

const MESSAGES: Record<UserErrorCode, string> = {
  USERNAME_TAKEN: "That username is already taken.",
  INVALID_CREDENTIALS: "That username or password isn't correct.",
  INVALID_TOKEN: "Your session has expired — log in again.",
  USER_NOT_FOUND: "No account with that username exists.",
  VALIDATION: "That value isn't valid.",
  // A real, resolved account — just not the operator's. See User.isAdmin's
  // own doc comment (prisma/schema.prisma) for why this exists at all.
  NOT_ADMIN: "This account can't host — only the streamer's account can.",
  // Deleting the (only) isAdmin account from the admin panel would strand
  // the whole /host flow — there's no UI path back to hosting once it's
  // gone, only a raw DB fix. Same "the operator account isn't just another
  // row" posture as NOT_ADMIN above, just enforced on the other end of the
  // relationship (deleting an admin, not logging in as a non-admin).
  CANNOT_DELETE_ADMIN: "This is the streamer's own admin account — it can't be deleted here.",
};

export class UserError extends Error {
  readonly code: UserErrorCode;

  constructor(code: UserErrorCode, message?: string) {
    super(message ?? MESSAGES[code]);
    this.name = "UserError";
    this.code = code;
  }
}
