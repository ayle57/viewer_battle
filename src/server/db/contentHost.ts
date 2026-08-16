import { ContentError } from "@/domain/content";
import { generateToken, hashToken } from "@/server/auth/token";
import { verifyHostPassword } from "@/server/auth/hostPassword";
import { prisma } from "@/server/db/client";

export interface ContentHostSession {
  token: string;
  hostId: string;
}

/**
 * Issues a brand-new, genuinely separate Content Studio identity — a raw
 * primitive, not what the real product's login button calls (see
 * `signInContentHost` below for that). Exists for callers that
 * specifically need a FRESH, independent ContentHost — today, only the
 * ownership/IDOR tests (tests/integration/content.test.ts's `freshHost`),
 * which construct "Host A" and "Host B" on purpose to prove one host's
 * playlists are unreachable from another's token. Gated behind the exact
 * same shared secret as session.create (verifyHostPassword — see
 * AGENTS.md "Session invariants").
 */
export async function createContentHost(hostPassword: string): Promise<ContentHostSession> {
  if (!verifyHostPassword(hostPassword)) {
    throw new ContentError("INVALID_HOST_PASSWORD");
  }
  const token = generateToken();
  const host = await prisma.contentHost.create({ data: { tokenHash: hashToken(token) } });
  return { token, hostId: host.id };
}

/**
 * What `/host/content`'s login form actually calls — this app runs one
 * specific streamer's show, not a multi-tenant platform (same posture as
 * `HOST_PASSWORD` itself, see AGENTS.md "Session invariants": "knows the
 * password the operator configured," not a per-user account), and that
 * same reality applies to Content Studio: there is exactly one real Host
 * identity in practice, so signing in again — a cleared browser, a new
 * device, an incognito window — must reattach to that SAME ContentHost
 * and its already-prepared playlists, never fork a second, empty one that
 * silently orphans everything already built (which `createContentHost`
 * above would do if the login form called it directly). Finds the
 * earliest-created ContentHost row (there should only ever be one produced
 * through this path) and rotates a fresh token onto it; only bootstraps a
 * new row the very first time anyone signs in at all. A fresh token
 * replacing the old one — rather than both staying valid — is the same
 * single-active-credential posture as every other identity in this app,
 * not a new rule invented here.
 */
export async function signInContentHost(hostPassword: string): Promise<ContentHostSession> {
  if (!verifyHostPassword(hostPassword)) {
    throw new ContentError("INVALID_HOST_PASSWORD");
  }
  const token = generateToken();
  const tokenHash = hashToken(token);
  const existing = await prisma.contentHost.findFirst({ orderBy: { createdAt: "asc" } });
  const host = existing
    ? await prisma.contentHost.update({ where: { id: existing.id }, data: { tokenHash } })
    : await prisma.contentHost.create({ data: { tokenHash } });
  return { token, hostId: host.id };
}

/** Resolves a Content Studio bearer token to the ContentHost it belongs to — the one lookup every content.* procedure goes through before touching a Playlist. */
export async function resolveContentHost(token: string): Promise<{ hostId: string }> {
  const host = await prisma.contentHost.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!host) throw new ContentError("INVALID_CONTENT_TOKEN");
  return { hostId: host.id };
}
