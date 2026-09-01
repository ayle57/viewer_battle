import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (password: string, salt: string, keylen: number) => Promise<Buffer>;

/**
 * Password hashing for real, user-chosen `User` credentials
 * (prisma/schema.prisma's own doc comment on why this is genuinely
 * low-stakes on purpose) — deliberately NOT the same tool as
 * src/server/auth/token.ts's plain SHA-256, and NOT hostPassword.ts's
 * plain timingSafeEqual compare. Those two secrets are either
 * high-entropy-and-random (a token — nothing for a slow hash to defend
 * against) or a single shared operator secret (HOST_PASSWORD — never
 * user-chosen, never stored per-account). A `User.passwordHash` is the
 * one secret in this app that's actually user-chosen and low-entropy by
 * construction (this app tells people to use a throwaway one), which is
 * exactly what a slow, salted hash exists to protect against offline
 * guessing if the DB ever leaked.
 *
 * `scrypt` (Node's own `node:crypto`, no new dependency — same "no new
 * package for something the platform already does" posture as every
 * other pass this session) rather than bcrypt/argon2, which aren't in
 * this project's dependencies and would be the only reason to add one.
 *
 * ASYNC (`crypto.scrypt`, not `scryptSync`): scrypt is deliberately
 * CPU-heavy, and there is no rate limit on `user.login` — the sync
 * variant blocks the whole event loop per call, so a handful of
 * concurrent login attempts would stall every other request. The async
 * form runs on libuv's threadpool instead.
 */
const KEY_LENGTH = 64;

/** "<saltHex>:<hashHex>" — one column, the salt stored right alongside its own hash, same spirit as every other single-column secret in this app. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, KEY_LENGTH);
  return `${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hashHex] = stored.split(":");
  if (!salt || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scrypt(password, salt, KEY_LENGTH);
  // Equal-length check before timingSafeEqual — same reasoning as
  // hostPassword.ts's own comment: it throws on mismatched lengths
  // instead of returning false, which a malformed/corrupt stored hash
  // could otherwise trigger as an unhandled exception.
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
