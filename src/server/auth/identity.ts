import type { ParticipantRole } from "@/domain/session";

/**
 * A resolved identity for a connected socket (or an authenticated tRPC
 * call): who they are, which session they belong to, and what role they
 * hold in it.
 *
 * This is the ONLY shape that socket handlers (src/server/sockets/*), the
 * tRPC session router, and the domain layer should depend on. How it gets
 * resolved — see tokenIdentity.ts — is an implementation detail behind
 * `resolveIdentity` (see index.ts).
 */
export interface SocketIdentity {
  participantId: string;
  sessionId: string;
  sessionCode: string;
  role: ParticipantRole;
  displayName: string;
}

/**
 * Resolves the raw Socket.IO handshake auth payload into a SocketIdentity,
 * or throws (a SessionError, in the real resolver) if it can't.
 */
export type IdentityResolver = (handshakeAuth: unknown) => Promise<SocketIdentity>;
