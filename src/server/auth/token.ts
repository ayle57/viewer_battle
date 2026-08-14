import { randomBytes, createHash } from "node:crypto";

/**
 * Opaque, high-entropy bearer token for Host/Player/Display identity.
 *
 * One scheme for all four roles (see AGENTS.md "Session invariants" for
 * why this stays simple instead of Host getting a separate cookie
 * mechanism for now) — the token is generated once at join time, handed
 * to the client, and never stored in plaintext: only its hash lives in
 * Postgres (Participant.tokenHash), so a DB leak doesn't hand out working
 * tokens.
 *
 * SHA-256 (not bcrypt/argon2) is the right tool here, unlike a user
 * password: the token already has 256 bits of entropy from
 * randomBytes(32), so there is nothing for a slow, brute-force-resistant
 * hash to defend against — the attack a slow hash exists to slow down
 * (guessing a low-entropy secret) doesn't apply to a token no one has to
 * memorize.
 */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
