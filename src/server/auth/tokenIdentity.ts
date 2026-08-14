import { z } from "zod";
import { SessionError } from "@/domain/session";
import { resolveParticipantByToken } from "@/server/db/participant";
import type { IdentityResolver, SocketIdentity } from "./identity";

const tokenHandshakeSchema = z.object({ token: z.string().min(1) });

/**
 * Real identity resolution: a bearer token issued by `session.join` (see
 * src/server/db/participant.ts), hashed and looked up against
 * Participant.tokenHash. This is the resolver devIdentity.ts's own
 * doc comment promised would eventually replace it — swapped in via
 * ./index.ts, so nothing outside src/server/auth had to change.
 */
export const resolveTokenIdentity: IdentityResolver = async (handshakeAuth): Promise<SocketIdentity> => {
  const parsed = tokenHandshakeSchema.safeParse(handshakeAuth);
  if (!parsed.success) throw new SessionError("INVALID_TOKEN");
  const participant = await resolveParticipantByToken(parsed.data.token);

  return {
    sessionId: participant.sessionId,
    sessionCode: participant.sessionCode,
    role: participant.role,
    displayName: participant.displayName,
  };
};
