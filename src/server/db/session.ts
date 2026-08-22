import { generateSessionCode, generateHostKey, SessionError, type SessionStatus } from "@/domain/session";
import { MAX_PLAYERS_PER_TEAM } from "@/domain/session";
import { getGameEngine } from "@/domain/game";
import { Prisma } from "@/generated/prisma/client";
import { hashToken } from "@/server/auth/token";
import { prisma } from "@/server/db/client";

const CODE_COLLISION_RETRIES = 5;

export interface CreateSessionResult {
  id: string;
  code: string;
  status: SessionStatus;
  /** Plaintext, one-time — only Session.hostKeyHash is ever persisted. See src/domain/session/hostKey.ts and reclaimHost in src/server/db/participant.ts. */
  hostKey: string;
}

/**
 * Creates a brand-new session with a fresh, unique, human-typeable code.
 * Retries on the (very unlikely) case of a code collision — the alphabet
 * is 30 characters, 6 of them, so a collision against existing sessions
 * is astronomically rare, but the unique constraint on Session.code is
 * still the real guarantee, not this retry loop.
 */
export async function createSession(): Promise<CreateSessionResult> {
  for (let attempt = 0; attempt < CODE_COLLISION_RETRIES; attempt++) {
    const code = generateSessionCode();
    const hostKey = generateHostKey();
    try {
      const session = await prisma.session.create({ data: { code, hostKeyHash: hashToken(hostKey) } });
      return { id: session.id, code: session.code, status: session.status, hostKey };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        continue; // code collision, try another
      }
      throw error;
    }
  }
  throw new Error("Could not generate a unique session code after several attempts");
}

/**
 * Ends a session for real, but as a soft `status: FINISHED` update, not a
 * delete — the row, its Participants, its ChatMessages, and every
 * SessionGame it ever ran all stay in the database. `getSessionState`
 * keeps resolving normally afterward (`status` just reads back
 * "FINISHED"); `resolveParticipantByToken`/`joinSession`/`reclaimHost`
 * all already refuse a FINISHED session with `SessionError
 * "SESSION_CLOSED"` (src/server/db/participant.ts) — that guard has been
 * in place all along, this function is what actually makes it reachable
 * again.
 *
 * This project briefly shipped a hard `prisma.session.delete` here
 * instead (every child row cascading via `onDelete: Cascade`), on the
 * theory that a lingering FINISHED row read as "the session is still
 * active" to a host glancing at it. That traded away the one thing a
 * soft finish gives for free — a session's own history surviving past
 * the show for later stats/debugging (see `getSessionState`'s
 * `matchScore`, computed from exactly this kind of surviving row) — for
 * a UX complaint that the real-time broadcast below already solves on
 * its own: the caller (session.finish's tRPC handler) fires
 * `session:ended` to every connected client BEFORE this runs
 * (src/server/sockets/session.ts), which is what actually delivers the
 * instant "session ended" screen; this status flip is the durable record
 * of that fact, for anyone who finds out about it some other way (a
 * reconnect, a fresh `session.getState` poll).
 */
export async function endSession(sessionId: string) {
  try {
    await prisma.session.update({ where: { id: sessionId }, data: { status: "FINISHED" } });
  } catch (error) {
    // Already gone (P2025 = "record to update does not exist") — treat as
    // success. Nothing in this app deletes a Session row anymore, so this
    // only matters for a sessionId that was never real to begin with;
    // idempotent is still the more honest contract than throwing on a
    // caller that already has a resolved sessionId in hand from before.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") return;
    throw error;
  }
}

/**
 * Rotates a session's own join code — the code alone is what a fresh
 * `session.join` looks the session up by (see joinSession,
 * src/server/db/participant.ts), so a NEW code is what actually stops
 * anyone who only knows the OLD one from connecting, without touching a
 * single already-connected participant: every one of them authenticates
 * by their own bearer token (tokenHash), never by the code, so
 * `resolveParticipantByToken`/reconnects/in-game actions all keep
 * working exactly as before through a rotation. Two real callers:
 *
 *   - The Host doing this on purpose (session.rotateCode, router.ts) —
 *     "I think this code leaked, or I just don't want more randoms
 *     showing up," the same reasoning a Discord invite link gets
 *     revoked and reissued for.
 *   - Automatically, the instant the Host kicks someone
 *     (session.kick) — a kicked participant otherwise still knows the
 *     (now-stale-to-THEM-only, still valid) code and could simply
 *     rejoin under a different display name the very next second;
 *     rotating turns "removed" into an actual barrier instead of a
 *     seat-only inconvenience, without needing any real per-person ban
 *     list this app has no other identity system to build one on top
 *     of.
 *
 * Same collision-retry posture as `createSession` — vanishingly
 * unlikely, the unique constraint is still the real guarantee.
 */
export async function rotateSessionCode(sessionId: string): Promise<string> {
  for (let attempt = 0; attempt < CODE_COLLISION_RETRIES; attempt++) {
    const code = generateSessionCode();
    try {
      const session = await prisma.session.update({ where: { id: sessionId }, data: { code } });
      return session.code;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        continue; // code collision, try another
      }
      throw error;
    }
  }
  throw new Error("Could not generate a unique session code after several attempts");
}

export interface SessionStateParticipant {
  id: string;
  displayName: string;
  seat: number | null;
}

export interface MatchScore {
  TEAM_A: number;
  TEAM_B: number;
}

export interface SessionState {
  code: string;
  status: SessionStatus;
  host: { id: string; displayName: string } | null;
  teamA: SessionStateParticipant[];
  teamB: SessionStateParticipant[];
  displayCount: number;
  capacity: {
    hostAvailable: boolean;
    teamASlotsRemaining: number;
    teamBSlotsRemaining: number;
  };
  /**
   * 1 point per game actually won across EVERY game this session has run
   * — see MatchScore.tsx/getGameEngine's `getWinner`. A TIE (or a game
   * whose engine has no concept of a winner) adds nothing for either
   * side. Independent of any single game's own in-game score, which
   * resets to 0-0 every game (see AGENTS.md "Session vs. Game phases").
   *
   * Deliberately counts EVERY finished game, with no dedup and no cap on
   * how many can ever count — a real, reported product decision: a
   * streamer running the same mini-game 45 times in a row must have all
   * 45 results count, never just the first. (An earlier "Show" layer
   * lived here — a fixed lineup of slots, one point value per slot, a
   * replay of an already-played game invisible to the score — and was
   * removed for exactly that reason: it silently stopped counting a
   * Host's own repeat games, which is never what "the streamer decides
   * what to play" is supposed to mean.)
   */
  matchScore: MatchScore;
}

/** Public-safe session summary — never includes tokenHash. Used by /dev/session and any future host/player/display view. */
export async function getSessionState(sessionCode: string): Promise<SessionState> {
  const session = await prisma.session.findUnique({
    where: { code: sessionCode },
    include: {
      participants: { orderBy: { createdAt: "asc" } },
      // Every FINISHED game this session has ever run, oldest first —
      // `internalState` stays fully opaque here too, same as everywhere
      // else in the bridge: read only through `getGameEngine(...).getWinner`,
      // never inspected directly.
      games: { where: { status: "FINISHED" }, orderBy: { startedAt: "asc" } },
    },
  });
  if (!session) throw new SessionError("SESSION_NOT_FOUND");

  const host = session.participants.find((p) => p.role === "HOST") ?? null;
  const byTeam = (role: "TEAM_A" | "TEAM_B") =>
    session.participants
      .filter((p) => p.role === role)
      .sort((a, b) => (a.seat ?? 0) - (b.seat ?? 0))
      .map((p) => ({ id: p.id, displayName: p.displayName, seat: p.seat }));
  const teamA = byTeam("TEAM_A");
  const teamB = byTeam("TEAM_B");
  const displayCount = session.participants.filter((p) => p.role === "DISPLAY").length;

  // Every FINISHED game counts, unconditionally — no dedup by gameKey,
  // no cap (see MatchScore field's own doc comment above for why).
  const matchScore: MatchScore = { TEAM_A: 0, TEAM_B: 0 };
  for (const game of session.games) {
    const winner = getGameEngine(game.gameKey)?.getWinner?.(game.internalState) ?? null;
    if (winner === "TEAM_A" || winner === "TEAM_B") matchScore[winner] += 1;
  }

  return {
    code: session.code,
    status: session.status,
    host: host ? { id: host.id, displayName: host.displayName } : null,
    teamA,
    teamB,
    displayCount,
    capacity: {
      hostAvailable: !host,
      teamASlotsRemaining: MAX_PLAYERS_PER_TEAM - teamA.length,
      teamBSlotsRemaining: MAX_PLAYERS_PER_TEAM - teamB.length,
    },
    matchScore,
  };
}
