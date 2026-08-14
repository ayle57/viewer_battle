import type { ChatRole } from "@/domain/chat";

/**
 * A resolved identity for a connected socket: who they are, which session
 * they belong to, and what role they hold in it.
 *
 * This is the ONLY shape that socket handlers (src/server/sockets/*) and
 * the domain layer should depend on. How it gets resolved — a dev form
 * today, real Host/Player/Display tokens tomorrow — is an implementation
 * detail behind `resolveIdentity` (see index.ts).
 */
export interface SocketIdentity {
  sessionId: string;
  sessionCode: string;
  role: ChatRole;
  displayName: string;
}

/**
 * Resolves the raw Socket.IO handshake auth payload into a SocketIdentity,
 * or throws if it can't (bad payload, unknown session, invalid token —
 * whatever the active implementation considers a rejection).
 */
export type IdentityResolver = (handshakeAuth: unknown) => Promise<SocketIdentity>;
