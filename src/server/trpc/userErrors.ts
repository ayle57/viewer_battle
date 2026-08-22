import { TRPCError } from "@trpc/server";
import { UserError, type UserErrorCode } from "@/domain/user";

const TRPC_CODE: Record<UserErrorCode, TRPCError["code"]> = {
  USERNAME_TAKEN: "CONFLICT",
  INVALID_CREDENTIALS: "UNAUTHORIZED",
  INVALID_TOKEN: "UNAUTHORIZED",
  USER_NOT_FOUND: "NOT_FOUND",
  VALIDATION: "BAD_REQUEST",
  NOT_ADMIN: "FORBIDDEN",
  CANNOT_DELETE_ADMIN: "FORBIDDEN",
};

/** Converts a UserError (thrown from src/server/db/user.ts) into a TRPCError — the account-system equivalent of toTRPCError/toContentTRPCError, kept separate for the same reason trpc.ts's errorFormatter doc comment gives for contentErrorCode vs. sessionErrorCode. */
export function toUserTRPCError(error: unknown): TRPCError {
  if (error instanceof UserError) {
    return new TRPCError({ code: TRPC_CODE[error.code], message: error.message, cause: error });
  }
  if (error instanceof TRPCError) return error;
  return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Internal error", cause: error });
}
