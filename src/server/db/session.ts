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
 * Ends a session for real: deletes the row outright, not a soft
 * `status: FINISHED` update. Every child row (Participant, ChatMessage,
 * SessionGame) cascades with it — `onDelete: Cascade` on each relation
 * in prisma/schema.prisma, so this one `delete` is the whole cleanup,
 * not the first of several queries.
 *
 * This used to be a soft finish (the row stayed, `resolveParticipantByToken`
 * just refused tokens for it — see SessionError "SESSION_CLOSED"), on the
 * theory that a lingering FINISHED row let Player/Display keep polling
 * `session.getState` and land on a graceful "session ended" screen on
 * their own. In practice a real host reported this reading as "the
 * session is still active" and asked for it to actually go away — so the
 * caller (session.finish's tRPC handler) now broadcasts a real-time
 * `session:ended` socket event to every connected client BEFORE this
 * runs (src/server/sockets/session.ts), which is what actually delivers
 * the graceful goodbye now; a client that reconnects later instead of
 * having stayed connected gets a plain SESSION_NOT_FOUND from
 * `getSessionState`, which the product pages treat the same way (see
 * `sessionEnded` in gameStore.ts / each page's phase computation).
 */
export async function endSession(sessionId: string) {
  try {
    await prisma.session.delete({ where: { id: sessionId } });
  } catch (error) {
    // Already gone (P2025 = "record to delete does not exist") — treat as
    // success. The tRPC handler always resolves the caller's token first,
    // which already fails on a second call once THIS runs once (the
    // participant row is cascade-gone too), so this only matters for a
    // caller that already has a resolved sessionId in hand from before —
    // idempotent is simply the more honest contract for a delete.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") return;
    throw error;
  }
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
  /** 1 point per game actually won across every game this session has run — see MatchScore/getGameEngine's `getWinner`. A TIE (or a game whose engine has no concept of a winner) adds nothing for either side. Independent of any single game's own in-game score, which resets to 0-0 every game (see AGENTS.md "Session vs. Game phases"). */
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

  const matchScore: MatchScore = { TEAM_A: 0, TEAM_B: 0 };
  for (const game of session.games) {
    const winner = getGameEngine(game.gameKey)?.getWinner?.(game.internalState);
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
