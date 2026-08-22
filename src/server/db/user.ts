import { Prisma } from "@/generated/prisma/client";
import { UserError, type ChangePasswordInput, type LoginInput, type RegisterInput } from "@/domain/user";
import { generateToken, hashToken } from "@/server/auth/token";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { prisma } from "@/server/db/client";

export interface UserSession {
  token: string;
  userId: string;
  username: string;
  isAdmin: boolean;
}

/**
 * Creates a brand-new account and immediately logs it in — one round
 * trip, matching how every OTHER join/create flow in this app (session
 * create+join, ContentHost sign-in) already hands back a working bearer
 * token instead of "created, now log in separately." Uniqueness is
 * enforced by the DB's own `@@unique` on `username` (P2002 below), not a
 * separate pre-check — same race-safety posture as
 * src/server/db/participant.ts's joinSession, not a new pattern.
 */
export async function registerUser(input: RegisterInput): Promise<UserSession> {
  const token = generateToken();
  try {
    const user = await prisma.user.create({
      data: { username: input.username, passwordHash: hashPassword(input.password), tokenHash: hashToken(token) },
    });
    return { token, userId: user.id, username: user.username, isAdmin: user.isAdmin };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new UserError("USERNAME_TAKEN");
    }
    throw error;
  }
}

/**
 * Rotates a fresh token onto the account — same single-active-credential
 * posture as ContentHost.signInContentHost (a previous login's token
 * stops resolving the moment a new one is issued). One generic
 * INVALID_CREDENTIALS for both "no such username" and "wrong password" —
 * never reveal which half was wrong to an unauthenticated caller, the
 * same information-hiding posture PARTICIPANT_NOT_FOUND already uses
 * for kick's IDOR-safe lookups.
 */
export async function loginUser(input: LoginInput): Promise<UserSession> {
  const user = await prisma.user.findUnique({ where: { username: input.username } });
  if (!user || !verifyPassword(input.password, user.passwordHash)) {
    throw new UserError("INVALID_CREDENTIALS");
  }
  const token = generateToken();
  await prisma.user.update({ where: { id: user.id }, data: { tokenHash: hashToken(token) } });
  return { token, userId: user.id, username: user.username, isAdmin: user.isAdmin };
}

/** A REAL, server-side logout — clears `tokenHash` so the old token stops resolving anywhere, not just a client-side "forget it" (see identityStore.ts's own, deliberately lighter-weight "Forget this session" for the contrast: that one leaves the seat live server-side on purpose, this one is a genuine account sign-out). */
export async function logoutUser(token: string): Promise<void> {
  await prisma.user.updateMany({ where: { tokenHash: hashToken(token) }, data: { tokenHash: null } });
}

export interface ResolvedUser {
  userId: string;
  username: string;
  isAdmin: boolean;
}

/** Resolves a bearer token to the account it belongs to — the one lookup every authenticated user.* procedure goes through, same shape as resolveContentHost/resolveParticipantByToken. */
export async function resolveUserByToken(token: string): Promise<ResolvedUser> {
  const user = await prisma.user.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!user) throw new UserError("INVALID_TOKEN");
  return { userId: user.id, username: user.username, isAdmin: user.isAdmin };
}

/**
 * The one check that actually authorizes `/host`'s own session.create
 * via a real account (src/server/trpc/router.ts) — an ADDITIVE
 * alternative to typing HOST_PASSWORD directly, never a replacement for
 * it (HOST_PASSWORD keeps working verbatim for the /dev playground and
 * anything else that already sends it). A real, resolved account that
 * just isn't `isAdmin` gets a distinct NOT_ADMIN, not a generic
 * INVALID_TOKEN — that account is genuinely who it says it is, it's
 * just not the streamer's, a materially different fact worth its own
 * message (see User.isAdmin's own doc comment, prisma/schema.prisma).
 */
export async function resolveAdminUserByToken(token: string): Promise<ResolvedUser> {
  const user = await resolveUserByToken(token);
  if (!user.isAdmin) throw new UserError("NOT_ADMIN");
  return user;
}

export async function changeUsername(token: string, newUsername: string): Promise<ResolvedUser> {
  const { userId } = await resolveUserByToken(token);
  try {
    const updated = await prisma.user.update({ where: { id: userId }, data: { username: newUsername } });
    return { userId: updated.id, username: updated.username, isAdmin: updated.isAdmin };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new UserError("USERNAME_TAKEN");
    }
    throw error;
  }
}

/** Requires the CURRENT password, not just a valid token — a stolen/left-open browser tab shouldn't be enough on its own to lock the real owner out by changing their password, the same "prove you still know the secret" step any real account settings page has. */
export async function changePassword(input: ChangePasswordInput): Promise<void> {
  const user = await prisma.user.findUnique({ where: { tokenHash: hashToken(input.token) } });
  if (!user) throw new UserError("INVALID_TOKEN");
  if (!verifyPassword(input.currentPassword, user.passwordHash)) {
    throw new UserError("INVALID_CREDENTIALS");
  }
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: hashPassword(input.newPassword) } });
}

export interface UserStats {
  gamesPlayed: number;
  gamesWon: number;
  gamesTied: number;
  gamesLost: number;
}

/** A generic slice of SessionGame.internalState — same shape every engine's own state already shares (see GenericGameState in host/page.tsx / player/page.tsx), just read directly off the JSON column instead of the full engine type, since stats only ever need these two fields. */
interface FinishedGameShape {
  scores?: unknown;
  winner?: "TEAM_A" | "TEAM_B" | "TIE" | null;
}

/**
 * Real, computed-live stats — never a denormalized counter that could
 * drift out of sync with what actually happened (same "no caching,
 * always fresh" posture as getSessionState — see AGENTS.md and this
 * file's own callers' doc comments). A user's stats
 * are exactly: every FINISHED SessionGame belonging to a session where
 * this user held a TEAM_A/TEAM_B seat, scored against whichever role
 * their OWN Participant row in that session actually was.
 *
 * Deliberately TEAM_A/TEAM_B only — HOST/DISPLAY seats never "win" or
 * "lose" a game the way a team does, so linking an account to one of
 * those roles (perfectly possible — `Participant.userId` doesn't
 * restrict by role) simply never contributes to this count, not an
 * oversight.
 *
 * One Participant row can span MANY SessionGames (a Participant belongs
 * to a Session, and a Session plays several games over its lifetime —
 * see SessionGame's own doc comment) — this walks every one of this
 * user's team seats across every session they've ever played, not just
 * their most recent one.
 */
export async function getUserStats(userId: string): Promise<UserStats> {
  const seats = await prisma.participant.findMany({
    where: { userId, role: { in: ["TEAM_A", "TEAM_B"] } },
    select: { sessionId: true, role: true },
  });

  const stats: UserStats = { gamesPlayed: 0, gamesWon: 0, gamesTied: 0, gamesLost: 0 };
  if (seats.length === 0) return stats;

  const games = await prisma.sessionGame.findMany({
    where: { sessionId: { in: seats.map((s) => s.sessionId) }, status: "FINISHED" },
    select: { sessionId: true, internalState: true },
  });
  const gamesBySession = new Map<string, FinishedGameShape[]>();
  for (const game of games) {
    const list = gamesBySession.get(game.sessionId) ?? [];
    list.push(game.internalState as FinishedGameShape);
    gamesBySession.set(game.sessionId, list);
  }

  for (const seat of seats) {
    for (const game of gamesBySession.get(seat.sessionId) ?? []) {
      stats.gamesPlayed += 1;
      if (game.winner === "TIE") stats.gamesTied += 1;
      else if (game.winner === seat.role) stats.gamesWon += 1;
      else if (game.winner === "TEAM_A" || game.winner === "TEAM_B") stats.gamesLost += 1;
      // `winner: null` (a game ended without ever really finishing —
      // shouldn't happen for a FINISHED row in practice, but this stays
      // total rather than silently mis-counting an edge case as a loss).
    }
  }
  return stats;
}

export interface AdminUserRow extends ResolvedUser {
  createdAt: Date;
  stats: UserStats;
}

/**
 * The admin dashboard's user table — every account, newest first, each
 * with its own real computed stats (getUserStats above). N+1 by design,
 * not an oversight: this app has exactly one operator and, realistically,
 * a small viewer base (see hostPassword.ts's own "one specific streamer's
 * show" framing) — an admin page loaded a handful of times a stream is
 * nowhere near the scale where this would matter, and a single combined
 * query here would mean either raw SQL or a second, denormalized way to
 * compute the exact same numbers getUserStats already gets right once.
 */
export async function listUsersWithStats(): Promise<AdminUserRow[]> {
  const users = await prisma.user.findMany({ orderBy: { createdAt: "desc" } });
  return Promise.all(
    users.map(async (user) => ({
      userId: user.id,
      username: user.username,
      isAdmin: user.isAdmin,
      createdAt: user.createdAt,
      stats: await getUserStats(user.id),
    })),
  );
}

export interface PlatformStats {
  totalUsers: number;
  totalSessions: number;
  totalGamesFinished: number;
  /** Sessions with at least one connected TEAM_A/TEAM_B seat linked to a real account — "how much of the real activity is happening under logged-in accounts," not a count of accounts themselves (totalUsers, above, already covers that). */
  sessionsWithAnAccountPlaying: number;
}

/** The admin dashboard's top-line numbers — platform-wide, not scoped to any one user. Same "real computed query, not a stored counter" posture as getUserStats. */
export async function getPlatformStats(): Promise<PlatformStats> {
  const [totalUsers, totalSessions, totalGamesFinished, sessionsWithAnAccountPlaying] = await Promise.all([
    prisma.user.count(),
    prisma.session.count(),
    prisma.sessionGame.count({ where: { status: "FINISHED" } }),
    prisma.participant
      .findMany({ where: { userId: { not: null }, role: { in: ["TEAM_A", "TEAM_B"] } }, select: { sessionId: true }, distinct: ["sessionId"] })
      .then((rows) => rows.length),
  ]);
  return { totalUsers, totalSessions, totalGamesFinished, sessionsWithAnAccountPlaying };
}

/**
 * Admin-only: permanently removes an account. `onDelete: SetNull` on
 * Participant.userId (prisma/schema.prisma) means every session/game that
 * account ever played stays intact — this only stops attributing them to
 * anyone, it never deletes gameplay history.
 *
 * Refuses to delete an `isAdmin: true` account, full stop — there's
 * exactly one (see User.isAdmin's own doc comment), it's the streamer's
 * own login, and the admin panel that calls this is itself gated by that
 * same account's ContentHost token (adminRouter.ts). Deleting it here
 * would lock the operator out of hosting with no UI path back in, only a
 * raw DB fix — checked BEFORE the delete, not caught after, so it never
 * even attempts the row.
 */
export async function deleteUser(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new UserError("USER_NOT_FOUND");
  if (user.isAdmin) throw new UserError("CANNOT_DELETE_ADMIN");
  await prisma.user.delete({ where: { id: userId } });
}
