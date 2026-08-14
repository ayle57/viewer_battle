import { z } from "zod";
import { chatRoleSchema, displayNameSchema } from "@/domain/chat";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import type { IdentityResolver, SocketIdentity } from "./identity";

/**
 * DEV-ONLY identity resolution — NOT the real auth system.
 *
 * Trusts whatever session code / role / display name the client sends in
 * the handshake, and auto-creates the Session row on first join so
 * /dev/chat works without a separate "create session" step. This is
 * exactly what real auth must NOT do (a client should never get to pick
 * its own role).
 *
 * Replace with real Host/Player/Display token verification in the next
 * phase: swap the export in ./index.ts to a new resolver with the same
 * `IdentityResolver` signature. Nothing outside src/server/auth should
 * need to change — chat handlers and the domain layer only ever see the
 * resulting SocketIdentity, never this payload shape.
 */
const devHandshakeSchema = z.object({
  sessionCode: z
    .string()
    .trim()
    .min(1, "Session code is required")
    .max(60, "Session code is too long"),
  role: chatRoleSchema,
  displayName: displayNameSchema,
});

/**
 * Gets or creates the Session row for a code. Two sockets can race to
 * create the same brand-new session (e.g. host + players all joining at
 * once) — the upsert's create side can lose that race and hit the unique
 * constraint on `code` instead of silently falling back to update, so on
 * a P2002 we just re-read the row the winner created.
 */
async function getOrCreateSession(code: string) {
  try {
    return await prisma.session.upsert({
      where: { code },
      create: { code },
      update: {},
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return prisma.session.findUniqueOrThrow({ where: { code } });
    }
    throw error;
  }
}

export const resolveDevIdentity: IdentityResolver = async (handshakeAuth): Promise<SocketIdentity> => {
  const parsed = devHandshakeSchema.parse(handshakeAuth);

  const session = await getOrCreateSession(parsed.sessionCode);

  return {
    sessionId: session.id,
    sessionCode: session.code,
    role: parsed.role,
    displayName: parsed.displayName,
  };
};
