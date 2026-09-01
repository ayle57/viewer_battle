import { TRPCError } from "@trpc/server";
import { ContentError, type ContentErrorCode } from "@/domain/content";

const TRPC_CODE: Record<ContentErrorCode, TRPCError["code"]> = {
  INVALID_HOST_PASSWORD: "UNAUTHORIZED",
  INVALID_CONTENT_TOKEN: "UNAUTHORIZED",
  PLAYLIST_NOT_FOUND: "NOT_FOUND",
  CATEGORY_NOT_FOUND: "NOT_FOUND",
  QUESTION_NOT_FOUND: "NOT_FOUND",
  CATEGORY_NOT_EMPTY: "CONFLICT",
  ROUND_NOT_FOUND: "NOT_FOUND",
  PROMPT_NOT_FOUND: "NOT_FOUND",
  TRACK_NOT_FOUND: "NOT_FOUND",
  STEAM_GAME_NOT_FOUND: "NOT_FOUND",
  PRICE_ITEM_NOT_FOUND: "NOT_FOUND",
  VALIDATION: "BAD_REQUEST",
  // Distinct from VALIDATION (a single bad field on ONE mutation) —
  // this means "the playlist as a whole can't be used to start a game
  // yet," a precondition on a different operation entirely (game.start).
  PLAYLIST_NOT_READY: "PRECONDITION_FAILED",
};

/** Converts a ContentError (thrown from src/server/db/content.ts / contentHost.ts) into a TRPCError — the Content Studio equivalent of src/server/trpc/errors.ts's toTRPCError, kept separate on purpose (see trpc.ts's errorFormatter doc comment). */
export function toContentTRPCError(error: unknown): TRPCError {
  if (error instanceof ContentError) {
    return new TRPCError({ code: TRPC_CODE[error.code], message: error.message, cause: error });
  }
  if (error instanceof TRPCError) return error;
  return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Internal error", cause: error });
}
