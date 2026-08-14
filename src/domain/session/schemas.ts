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
});
export type JoinSessionInput = z.infer<typeof joinSessionInputSchema>;
