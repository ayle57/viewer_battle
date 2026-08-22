import { z } from "zod";
import { participantRoleSchema } from "./role";

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, "Display name is required")
  .max(40, "Display name is too long (max 40 characters)");

export const sessionCodeSchema = z
  .string()
  .trim()
  .min(1, "Session code is required")
  .max(60, "Session code is too long")
  // Session codes are generated uppercase (see sessionCode.ts) but joining
  // is case-insensitive at the input layer — normalized before lookup.
  .transform((value) => value.toUpperCase());

export const joinSessionInputSchema = z.object({
  sessionCode: sessionCodeSchema,
  role: participantRoleSchema,
  displayName: displayNameSchema,
  /** An existing token for THIS session, if reconnecting (e.g. page reload) — makes join idempotent instead of claiming a second seat. */
  token: z.string().min(1).optional(),
  /**
   * A real `User` account's own bearer token (src/domain/user), entirely
   * separate from `token` above — purely additive, purely optional. When
   * present and it resolves to a real account, `joinSession`
   * (src/server/db/participant.ts) stamps `Participant.userId` so this
   * seat's games count toward that account's real stats
   * (src/server/db/user.ts's getUserStats). An invalid/expired one is
   * silently ignored (join still succeeds as a plain, account-less seat)
   * — a stale account login should never be able to block joining a game
   * the way an invalid session `token` legitimately would.
   */
  accountToken: z.string().min(1).optional(),
});
export type JoinSessionInput = z.infer<typeof joinSessionInputSchema>;

/**
 * Reclaiming the HOST seat with the recovery key shown once at
 * session.create (hostKey.ts) instead of an existing token — the path
 * for "I lost my token" (browser closed, sessionStorage cleared), as
 * opposed to joinSessionInputSchema's `token`, which is the silent,
 * same-tab reconnect path. See reclaimHost in src/server/db/participant.ts.
 */
export const reclaimHostInputSchema = z.object({
  sessionCode: sessionCodeSchema,
  hostKey: z.string().trim().min(1, "Recovery key is required"),
  displayName: displayNameSchema,
});
export type ReclaimHostInput = z.infer<typeof reclaimHostInputSchema>;
