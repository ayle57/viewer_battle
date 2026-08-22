import { z } from "zod";
import { router, publicProcedure } from "@/server/trpc/trpc";
import { toUserTRPCError } from "@/server/trpc/userErrors";
import { registerInputSchema, loginInputSchema, changeUsernameInputSchema, changePasswordInputSchema } from "@/domain/user";
import {
  registerUser,
  loginUser,
  logoutUser,
  resolveUserByToken,
  changeUsername,
  changePassword,
  getUserStats,
} from "@/server/db/user";

/**
 * The real, persistent `User` account system's tRPC surface — see
 * prisma/schema.prisma's own User doc comment for why this is a THIRD
 * identity system, deliberately separate from `session` (Participant)
 * and `content.auth` (ContentHost) above. Every mutation/query here
 * re-derives `userId` from `token` itself inside src/server/db/user.ts
 * (never trusts a `userId` passed by the client) — same IDOR-safe shape
 * every other identity system in this app already uses.
 *
 * Entirely optional: nothing in `session`/`game` requires a `user.*`
 * token to exist — joining a game with just a display name (the
 * "compte provisoire" flow, src/app/_shared/lastDisplayName.ts) keeps
 * working exactly as before. `session.join`'s own `accountToken` (see
 * router.ts) is the one bridge between the two systems — purely additive,
 * stamping `Participant.userId` when present, never required.
 */
export const userRouter = router({
  register: publicProcedure.input(registerInputSchema).mutation(async ({ input }) => {
    try {
      return await registerUser(input);
    } catch (error) {
      throw toUserTRPCError(error);
    }
  }),

  login: publicProcedure.input(loginInputSchema).mutation(async ({ input }) => {
    try {
      return await loginUser(input);
    } catch (error) {
      throw toUserTRPCError(error);
    }
  }),

  logout: publicProcedure.input(z.object({ token: z.string().min(1) })).mutation(async ({ input }) => {
    await logoutUser(input.token);
    return { ok: true as const };
  }),

  /** Resolves a stored token back to the account it belongs to, plus that account's own real, computed stats — one call, since /account's own load always wants both together. */
  me: publicProcedure.input(z.object({ token: z.string().min(1) })).query(async ({ input }) => {
    try {
      const identity = await resolveUserByToken(input.token);
      const stats = await getUserStats(identity.userId);
      return { ...identity, stats };
    } catch (error) {
      throw toUserTRPCError(error);
    }
  }),

  changeUsername: publicProcedure.input(changeUsernameInputSchema).mutation(async ({ input }) => {
    try {
      return await changeUsername(input.token, input.newUsername);
    } catch (error) {
      throw toUserTRPCError(error);
    }
  }),

  changePassword: publicProcedure.input(changePasswordInputSchema).mutation(async ({ input }) => {
    try {
      await changePassword(input);
      return { ok: true as const };
    } catch (error) {
      throw toUserTRPCError(error);
    }
  }),
});
