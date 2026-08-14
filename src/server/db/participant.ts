import { isTeamRole, MAX_PLAYERS_PER_TEAM, SessionError, type JoinSessionInput } from "@/domain/session";
import { Prisma } from "@/generated/prisma/client";
import { generateToken, hashToken } from "@/server/auth/token";
import { prisma } from "@/server/db/client";
import { isHostConnected } from "@/server/sockets/presence";

export interface JoinSessionResult {
  id: string;
  token: string;
  sessionCode: string;
  role: JoinSessionInput["role"];
  displayName: string;
  /** True if this reused an existing valid token for this session instead of claiming a new seat. */
  reused: boolean;
}

/**
 * Claims a seat in a session — the one place Participant rows get
 * created. Two things make concurrent joins safe, not this function's
 * own control flow:
 *
 *   1. The Postgres unique constraints (@@unique([sessionId, role, seat])
 *      for teams, the hand-written partial index for HOST — see
 *      prisma/schema.prisma). Under READ COMMITTED (Postgres's default),
 *      two concurrent requests CAN both pass the capacity pre-check below
 *      and both attempt to insert — the pre-check exists only to produce
 *      a friendlier error in the common (non-race) case. Whichever
 *      INSERT loses the race hits the unique constraint (P2002), and
 *      *that's* converted to the same SessionError below. Neither team
 *      capacity nor "one host" depends on application-level locking.
 *   2. The token round-trip: if the caller already holds a valid token
 *      for this exact session, joining again is idempotent (returns the
 *      same seat) instead of claiming a second one.
 */
export async function joinSession(input: JoinSessionInput): Promise<JoinSessionResult> {
  if (input.token) {
    const reused = await tryReuseToken(input.token, input.sessionCode);
    if (reused) return reused;
    // Token didn't resolve, or belongs to a different session — fall
    // through and treat this as a fresh join.
  }

  const session = await prisma.session.findUnique({ where: { code: input.sessionCode } });
  if (!session) throw new SessionError("SESSION_NOT_FOUND");
  if (session.status === "FINISHED") throw new SessionError("SESSION_CLOSED");

  // The core access-control rule: a session code alone is never enough
  // to claim a NEW seat as anything other than the host — the host must
  // be genuinely connected right now (real Socket.IO presence, not a DB
  // flag). Reconnecting with an existing token (tryReuseToken, above)
  // skips this entirely on purpose — a player already in the game keeps
  // working through a host disconnect, only NEW joins are gated.
  if (input.role !== "HOST" && !isHostConnected(session.id)) {
    throw new SessionError("HOST_NOT_CONNECTED");
  }

  const token = generateToken();
  const tokenHash = hashToken(token);

  try {
    const participantId = await prisma.$transaction(async (tx) => {
      if (input.role === "HOST") {
        const existingHost = await tx.participant.findFirst({ where: { sessionId: session.id, role: "HOST" } });
        if (existingHost) throw new SessionError("HOST_ALREADY_CONNECTED");
        const created = await tx.participant.create({
          data: { sessionId: session.id, role: "HOST", displayName: input.displayName, tokenHash },
        });
        return created.id;
      }

      if (input.role === "DISPLAY") {
        const created = await tx.participant.create({
          data: { sessionId: session.id, role: "DISPLAY", displayName: input.displayName, tokenHash },
        });
        return created.id;
      }

      if (isTeamRole(input.role)) {
        const teamCount = await tx.participant.count({ where: { sessionId: session.id, role: input.role } });
        if (teamCount >= MAX_PLAYERS_PER_TEAM) throw new SessionError("TEAM_FULL");
        const created = await tx.participant.create({
          data: {
            sessionId: session.id,
            role: input.role,
            seat: teamCount + 1,
            displayName: input.displayName,
            tokenHash,
          },
        });
        return created.id;
      }

      throw new SessionError("FORBIDDEN"); // unreachable given JoinSessionInput's role union, but keeps this function total
    });

    if (session.status === "CREATED") {
      await prisma.session.update({ where: { id: session.id }, data: { status: "ACTIVE" } });
    }

    return { id: participantId, token, sessionCode: session.code, role: input.role, displayName: input.displayName, reused: false };
  } catch (error) {
    if (error instanceof SessionError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // Lost the race at the DB constraint itself.
      throw new SessionError(input.role === "HOST" ? "HOST_ALREADY_CONNECTED" : "TEAM_FULL");
    }
    throw error;
  }
}

async function tryReuseToken(token: string, sessionCode: string): Promise<JoinSessionResult | null> {
  const participant = await prisma.participant.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { session: true },
  });
  if (!participant || participant.session.code !== sessionCode) return null;

  return {
    id: participant.id,
    token,
    sessionCode: participant.session.code,
    role: participant.role,
    displayName: participant.displayName,
    reused: true,
  };
}

export interface ResolvedParticipant {
  participantId: string;
  sessionId: string;
  sessionCode: string;
  sessionStatus: "CREATED" | "ACTIVE" | "FINISHED";
  role: JoinSessionInput["role"];
  displayName: string;
}

/** Resolves a bearer token to the participant it belongs to — the one real identity lookup shared by Socket.IO auth and any authenticated tRPC procedure (see src/server/auth). */
export async function resolveParticipantByToken(token: string): Promise<ResolvedParticipant> {
  const participant = await prisma.participant.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { session: true },
  });
  if (!participant) throw new SessionError("INVALID_TOKEN");
  if (participant.session.status === "FINISHED") throw new SessionError("SESSION_CLOSED");

  return {
    participantId: participant.id,
    sessionId: participant.sessionId,
    sessionCode: participant.session.code,
    sessionStatus: participant.session.status,
    role: participant.role,
    displayName: participant.displayName,
  };
}
