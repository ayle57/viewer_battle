import { isTeamRole, MAX_PLAYERS_PER_TEAM, SessionError, type JoinSessionInput, type ReclaimHostInput } from "@/domain/session";
import { Prisma } from "@/generated/prisma/client";
import { generateToken, hashToken } from "@/server/auth/token";
import { prisma } from "@/server/db/client";
import { isHostConnected, isParticipantConnected } from "@/server/sockets/presence";

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
  // Purely additive, never blocking — see joinSessionInputSchema's own
  // doc comment on `accountToken`. Resolved once, up front, so every
  // branch below (HOST/DISPLAY/TEAM_A/TEAM_B) stamps the exact same
  // value without re-resolving it per branch.
  const userId = input.accountToken ? await resolveAccountUserId(input.accountToken) : null;

  // No-account joins can't borrow a real account's name — see
  // DISPLAY_NAME_MATCHES_ACCOUNT's own doc comment. Skipped entirely once
  // `userId` resolved (the joiner IS a real, signed-in account here —
  // whatever name they pick, they're not impersonating anyone by seat
  // attribution alone), and a pre-check outside the transaction on
  // purpose, same "friendlier error in the common case" posture as the
  // host-connected/team-capacity checks above — this is cosmetic
  // collision-prevention, not a security boundary that needs
  // transactional exactness.
  if (!userId) {
    const takenByAccount = await prisma.user.findFirst({
      where: { username: { equals: input.displayName, mode: "insensitive" } },
      select: { id: true },
    });
    if (takenByAccount) throw new SessionError("DISPLAY_NAME_MATCHES_ACCOUNT");
  }

  try {
    const { id: participantId, reused } = await prisma.$transaction(async (tx) => {
      if (input.role === "HOST") {
        const existingHost = await tx.participant.findFirst({ where: { sessionId: session.id, role: "HOST" } });
        if (existingHost) throw new SessionError("HOST_ALREADY_CONNECTED");
        const created = await tx.participant.create({
          data: { sessionId: session.id, role: "HOST", displayName: input.displayName, tokenHash, userId },
        });
        return { id: created.id, reused: false };
      }

      if (input.role === "DISPLAY") {
        const created = await tx.participant.create({
          data: { sessionId: session.id, role: "DISPLAY", displayName: input.displayName, tokenHash, userId },
        });
        return { id: created.id, reused: false };
      }

      if (isTeamRole(input.role)) {
        // Reclaim-by-name: TEAM_A/TEAM_B have no recovery-key flow the
        // way HOST does (reclaimHost, below) — a player who loses their
        // token (closed tab, different device) has no other way back
        // into THEIR OWN seat, and would otherwise either take a second,
        // fresh seat (leaving their old row sitting in the roster
        // forever, "Offline") or hit TEAM_FULL outright once both seats
        // are nominally taken even though one holder plainly isn't there
        // anymore. Reclaiming is only safe once the old seat is
        // genuinely unattended right now — a LIVE presence check
        // (isParticipantConnected), not a DB flag, same posture
        // isHostConnected already uses above. Matched on exact
        // displayName within this session+role: a deliberately low-
        // stakes heuristic for a seat that never had a secret of its own
        // to prove, not a substitute for real auth — see this file's
        // reclaimHost for the higher-stakes HOST equivalent.
        const stale = await tx.participant.findFirst({ where: { sessionId: session.id, role: input.role, displayName: input.displayName } });
        if (stale && !isParticipantConnected(session.id, stale.id)) {
          // `userId ?? undefined`, not `userId` — this reclaim can run
          // with NO accountToken at all (an ordinary reconnect from a
          // browser that never logged into an account), and `undefined`
          // means "leave this column alone" to Prisma, while a bare
          // `null` would actively ERASE an already-stamped attribution
          // from an earlier join. Only ever ADDS an attribution (the
          // same real person reclaiming their seat after signing in for
          // the first time), never removes one.
          const updated = await tx.participant.update({ where: { id: stale.id }, data: { tokenHash, userId: userId ?? undefined } });
          return { id: updated.id, reused: true };
        }

        // The lowest FREE seat number, not `count + 1` — a team's seats
        // aren't guaranteed contiguous once kickParticipant (below) can
        // remove one from the middle (seat 1 kicked, seat 2 still
        // occupied: the next join must reuse seat 1, not collide with
        // seat 2 by computing `count(1) + 1 = 2`). Reads the existing
        // seats fresh inside this same transaction, so this stays exact
        // even alongside the P2002 race-loser fallback below.
        const existing = await tx.participant.findMany({ where: { sessionId: session.id, role: input.role }, select: { seat: true } });
        if (existing.length >= MAX_PLAYERS_PER_TEAM) throw new SessionError("TEAM_FULL");
        const takenSeats = new Set(existing.map((p) => p.seat));
        let seat = 1;
        while (takenSeats.has(seat)) seat++;
        const created = await tx.participant.create({
          data: {
            sessionId: session.id,
            role: input.role,
            seat,
            displayName: input.displayName,
            tokenHash,
            userId,
          },
        });
        return { id: created.id, reused: false };
      }

      throw new SessionError("FORBIDDEN"); // unreachable given JoinSessionInput's role union, but keeps this function total
    });

    if (session.status === "CREATED") {
      await prisma.session.update({ where: { id: session.id }, data: { status: "ACTIVE" } });
    }

    return { id: participantId, token, sessionCode: session.code, role: input.role, displayName: input.displayName, reused };
  } catch (error) {
    if (error instanceof SessionError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // Lost the race at the DB constraint itself.
      throw new SessionError(input.role === "HOST" ? "HOST_ALREADY_CONNECTED" : "TEAM_FULL");
    }
    throw error;
  }
}

/**
 * Resolves an `accountToken` (joinSessionInputSchema's own doc comment)
 * to a real `User.id`, or `null` for anything that doesn't resolve —
 * NEVER throws. A stale/invalid/logged-out account token must never be
 * able to block an otherwise-valid join the way an invalid session
 * `token` legitimately does; it just means this seat ends up
 * account-less, same as never having passed one at all. Queries
 * `prisma.user` directly (not src/server/db/user.ts's own
 * `resolveUserByToken`, which throws UserError on purpose for its own,
 * authenticated-caller callers) — this is the one deliberately
 * non-throwing lookup of a User by token in the app.
 */
async function resolveAccountUserId(accountToken: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { tokenHash: hashToken(accountToken) }, select: { id: true } });
  return user?.id ?? null;
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

/**
 * The recovery path for "the host lost their token" (browser closed,
 * sessionStorage cleared — see identityStore.ts) — proves control of the
 * session via the one-time recovery key (Session.hostKeyHash, set at
 * session.create) instead of an existing token, then rotates the HOST
 * Participant's tokenHash so a fresh token can be issued. Doesn't touch
 * the "exactly 1 HOST" invariant: this reclaims the SAME participant row,
 * it never creates a second one, so the partial unique index never even
 * enters into it.
 */
export async function reclaimHost(input: ReclaimHostInput): Promise<JoinSessionResult> {
  const session = await prisma.session.findUnique({ where: { code: input.sessionCode } });
  if (!session) throw new SessionError("SESSION_NOT_FOUND");
  if (session.status === "FINISHED") throw new SessionError("SESSION_CLOSED");
  if (!session.hostKeyHash || hashToken(input.hostKey) !== session.hostKeyHash) {
    throw new SessionError("INVALID_HOST_KEY");
  }

  const token = generateToken();
  const tokenHash = hashToken(token);
  const hostParticipant = await prisma.participant.findFirst({ where: { sessionId: session.id, role: "HOST" } });

  // No one has actually claimed the HOST seat yet — shouldn't happen in
  // practice (the create flow joins immediately after creating the
  // session) but the recovery key is still valid proof of control, so
  // this stays total rather than throwing on an edge case that just
  // means "claim it for the first time instead of rotating it".
  if (!hostParticipant) {
    const created = await prisma.participant.create({
      data: { sessionId: session.id, role: "HOST", displayName: input.displayName, tokenHash },
    });
    return { id: created.id, token, sessionCode: session.code, role: "HOST", displayName: created.displayName, reused: false };
  }

  const updated = await prisma.participant.update({
    where: { id: hostParticipant.id },
    data: { tokenHash, displayName: input.displayName },
  });
  return { id: updated.id, token, sessionCode: session.code, role: "HOST", displayName: updated.displayName, reused: true };
}

/**
 * A REAL, REPORTED UX gap this closes — walking `/host` as an actual
 * streamer surfaced it directly: the one-time recovery key made sense
 * back when a Host had no other real identity to prove control with,
 * but now that `/host` is gated behind a real, `isAdmin` account
 * (HostConnexion's own doc comment), making a Host copy/save a SECOND
 * secret just to survive a lost tab is redundant friction for the exact
 * account that's already proven who they are. Read-only — powers the
 * "Resume your show" shortcut on `/host`'s account gate, shown only
 * when this actually finds something; `null` means "nothing to resume,"
 * never an error (a brand-new Host with no show yet is the overwhelmingly
 * common case, not a failure).
 */
export async function findActiveHostSessionForAccount(accountToken: string): Promise<{ sessionCode: string } | null> {
  const userId = await resolveAccountUserId(accountToken);
  if (!userId) return null;
  const participant = await prisma.participant.findFirst({
    where: { userId, role: "HOST", session: { status: { not: "FINISHED" } } },
    orderBy: { createdAt: "desc" },
    include: { session: true },
  });
  return participant ? { sessionCode: participant.session.code } : null;
}

/**
 * The mutation half of the shortcut above — reclaims that SAME HOST
 * seat (rotates a fresh token onto it, same shape as `reclaimHost`'s own
 * hostKey-based path just above), an account-based alternative proof of
 * "I'm allowed back in," not a new invariant. `PARTICIPANT_NOT_FOUND`
 * covers the narrow race where the session finished between the
 * `findActiveHostSessionForAccount` read that showed the "Resume"
 * button and this actual click.
 */
export async function reclaimHostByAccount(accountToken: string): Promise<JoinSessionResult> {
  const userId = await resolveAccountUserId(accountToken);
  if (!userId) throw new SessionError("INVALID_TOKEN");
  const participant = await prisma.participant.findFirst({
    where: { userId, role: "HOST", session: { status: { not: "FINISHED" } } },
    orderBy: { createdAt: "desc" },
    include: { session: true },
  });
  if (!participant) throw new SessionError("PARTICIPANT_NOT_FOUND");

  const token = generateToken();
  const tokenHash = hashToken(token);
  const updated = await prisma.participant.update({ where: { id: participant.id }, data: { tokenHash } });
  return { id: updated.id, token, sessionCode: participant.session.code, role: "HOST", displayName: updated.displayName, reused: true };
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

export interface KickedParticipant {
  role: JoinSessionInput["role"];
  displayName: string;
}

/**
 * Host-only: forcibly frees one seat — a real delete, unlike
 * endSession's soft finish (that's the whole SHOW's own record, this is
 * one player's seat; no game history reads a Participant row by id or
 * displayName, only by team ROLE — see e.g. GeoGuessrEngine's
 * `GeoRoundResult`, keyed TEAM_A/TEAM_B — so removing this row loses
 * nothing worth keeping). The freed seat is immediately rejoinable: the
 * caller (src/server/trpc/router.ts's `session.kick`) is what actually
 * disconnects the kicked participant's live socket(s)
 * (broadcastParticipantKicked, src/server/sockets/session.ts) — this
 * function only touches the database.
 *
 * `hostSessionId` scopes the lookup so a Host can never kick a
 * participant from a DIFFERENT session by guessing an id (same IDOR-safe
 * "filter ownership in the query" posture as every other host-scoped
 * lookup in this app) — PARTICIPANT_NOT_FOUND either way, never leaking
 * whether the id exists elsewhere. The HOST seat itself is never a valid
 * target: there's exactly one, and removing it is what endSession (the
 * whole show ending) is for, not this.
 */
export async function kickParticipant(hostSessionId: string, targetParticipantId: string): Promise<KickedParticipant> {
  const target = await prisma.participant.findUnique({ where: { id: targetParticipantId } });
  if (!target || target.sessionId !== hostSessionId) throw new SessionError("PARTICIPANT_NOT_FOUND");
  if (target.role === "HOST") throw new SessionError("FORBIDDEN");

  try {
    await prisma.participant.delete({ where: { id: target.id } });
  } catch (error) {
    // The narrow window between the findUnique above and this delete —
    // a second concurrent kick (two Host tabs) could delete the row in
    // between. Swallowed for the same reason endSession's own P2025
    // handling is: the end state ("this participant is gone") is
    // identical either way. NOT full idempotency end-to-end, though — a
    // fully SEQUENTIAL second call fails at the findUnique above
    // instead, with a real PARTICIPANT_NOT_FOUND (see this function's
    // own test coverage) — there's no still-there row left to describe
    // in a `KickedParticipant` return value by then.
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025")) throw error;
  }

  return { role: target.role, displayName: target.displayName };
}
