import { generateSessionCode, SessionError, type SessionStatus } from "@/domain/session";
import { MAX_PLAYERS_PER_TEAM } from "@/domain/session";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";

const CODE_COLLISION_RETRIES = 5;

/**
 * Creates a brand-new session with a fresh, unique, human-typeable code.
 * Retries on the (very unlikely) case of a code collision — the alphabet
 * is 30 characters, 6 of them, so a collision against existing sessions
 * is astronomically rare, but the unique constraint on Session.code is
 * still the real guarantee, not this retry loop.
 */
export async function createSession() {
  for (let attempt = 0; attempt < CODE_COLLISION_RETRIES; attempt++) {
    const code = generateSessionCode();
    try {
      return await prisma.session.create({ data: { code } });
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
 * Marks a session FINISHED. No longer joinable afterward, and tokens for
 * it stop resolving (see resolveParticipantByToken) — see
 * src/domain/session/status.ts for why there's no CLOSED/EXPIRED yet.
 */
export async function finishSession(sessionId: string) {
  await prisma.session.update({ where: { id: sessionId }, data: { status: "FINISHED" as SessionStatus } });
}

export interface SessionStateParticipant {
  displayName: string;
  seat: number | null;
}

export interface SessionState {
  code: string;
  status: SessionStatus;
  host: { displayName: string } | null;
  teamA: SessionStateParticipant[];
  teamB: SessionStateParticipant[];
  displayCount: number;
  capacity: {
    hostAvailable: boolean;
    teamASlotsRemaining: number;
    teamBSlotsRemaining: number;
  };
}

/** Public-safe session summary — never includes tokenHash. Used by /dev/session and any future host/player/display view. */
export async function getSessionState(sessionCode: string): Promise<SessionState> {
  const session = await prisma.session.findUnique({
    where: { code: sessionCode },
    include: { participants: { orderBy: { createdAt: "asc" } } },
  });
  if (!session) throw new SessionError("SESSION_NOT_FOUND");

  const host = session.participants.find((p) => p.role === "HOST") ?? null;
  const byTeam = (role: "TEAM_A" | "TEAM_B") =>
    session.participants
      .filter((p) => p.role === role)
      .sort((a, b) => (a.seat ?? 0) - (b.seat ?? 0))
      .map((p) => ({ displayName: p.displayName, seat: p.seat }));
  const teamA = byTeam("TEAM_A");
  const teamB = byTeam("TEAM_B");
  const displayCount = session.participants.filter((p) => p.role === "DISPLAY").length;

  return {
    code: session.code,
    status: session.status,
    host: host ? { displayName: host.displayName } : null,
    teamA,
    teamB,
    displayCount,
    capacity: {
      hostAvailable: !host,
      teamASlotsRemaining: MAX_PLAYERS_PER_TEAM - teamA.length,
      teamBSlotsRemaining: MAX_PLAYERS_PER_TEAM - teamB.length,
    },
  };
}
