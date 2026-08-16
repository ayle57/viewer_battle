import { ContentError } from "@/domain/content";
import { generateToken, hashToken } from "@/server/auth/token";
import { verifyHostPassword } from "@/server/auth/hostPassword";
import { prisma } from "@/server/db/client";

export interface ContentHostSession {
  token: string;
  hostId: string;
}

/**
 * Issues a brand-new persistent Content Studio identity — the entry
 * point at /host/content when the browser holds no stored token yet.
 * Gated behind the exact same shared secret as session.create
 * (verifyHostPassword — see AGENTS.md "Session invariants": this app has
 * one operator-configured password, not per-user credentials), so
 * "allowed to prepare content" and "allowed to start a show" are proven
 * the same way. Every call creates a new ContentHost row — there's no way
 * to prove "I'm the same Host who logged in yesterday" other than already
 * holding that Host's token client-side (see resolveContentHost below),
 * same honest limitation as every other identity in this app.
 */
export async function createContentHost(hostPassword: string): Promise<ContentHostSession> {
  if (!verifyHostPassword(hostPassword)) {
    throw new ContentError("INVALID_HOST_PASSWORD");
  }
  const token = generateToken();
  const host = await prisma.contentHost.create({ data: { tokenHash: hashToken(token) } });
  return { token, hostId: host.id };
}

/** Resolves a Content Studio bearer token to the ContentHost it belongs to — the one lookup every content.* procedure goes through before touching a Playlist. */
export async function resolveContentHost(token: string): Promise<{ hostId: string }> {
  const host = await prisma.contentHost.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!host) throw new ContentError("INVALID_CONTENT_TOKEN");
  return { hostId: host.id };
}
