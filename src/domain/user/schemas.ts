import { z } from "zod";

/**
 * Deliberately permissive lengths/charset — this is a username for a
 * gameshow viewer, not an enterprise account (see prisma/schema.prisma's
 * User doc comment on staying genuinely low-stakes). Letters/digits/
 * underscore/hyphen only, so it's always safe to show back verbatim
 * anywhere a display name already renders (chat, roster, admin table) —
 * same "trust the shape, not just the byte count" posture as
 * displayNameSchema (src/domain/session/schemas.ts), just a narrower
 * charset since a username also has to be typeable at login.
 */
export const usernameSchema = z
  .string()
  .trim()
  .min(3, "Username must be at least 3 characters")
  .max(24, "Username is too long (max 24 characters)")
  .regex(/^[a-zA-Z0-9_-]+$/, "Only letters, numbers, _ and - are allowed");

/**
 * Minimum-only, no complexity rules (no forced digit/symbol/uppercase) —
 * this app explicitly tells people to use a throwaway password (see
 * /account's own copy), so demanding a "strong" one would be dishonest
 * theater for a secret this low-stakes. Still real hashing server-side
 * (src/server/auth/password.ts) — "don't bother inventing a good one" is
 * advice to the USER, not permission for this app to handle it carelessly.
 */
export const passwordSchema = z.string().min(4, "Password must be at least 4 characters").max(200, "Password is too long");

export const registerInputSchema = z.object({ username: usernameSchema, password: passwordSchema });
export type RegisterInput = z.infer<typeof registerInputSchema>;

export const loginInputSchema = z.object({ username: z.string().trim().min(1, "Username is required"), password: z.string().min(1, "Password is required") });
export type LoginInput = z.infer<typeof loginInputSchema>;

export const changeUsernameInputSchema = z.object({ token: z.string().min(1), newUsername: usernameSchema });
export type ChangeUsernameInput = z.infer<typeof changeUsernameInputSchema>;

export const changePasswordInputSchema = z.object({
  token: z.string().min(1),
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordInputSchema>;
