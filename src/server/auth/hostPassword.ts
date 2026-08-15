import { timingSafeEqual } from "node:crypto";
import { DEV_PLAYGROUND_HOST_PASSWORD } from "@/domain/session";

/**
 * Gates `session.create` (src/server/trpc/router.ts) behind a single
 * shared secret set by whoever runs this deployment (`HOST_PASSWORD` in
 * `.env`) — this app is built for one specific streamer's show, not a
 * multi-tenant platform, so "can create a new game" isn't a per-user
 * permission, it's "knows the one password the operator configured."
 * Deliberately separate from the per-session host recovery key
 * (src/domain/session/hostKey.ts): that one proves "I'm the same host who
 * already created THIS session"; this one proves "I'm allowed to create a
 * session AT ALL." Different question, checked at a different point.
 *
 * `timingSafeEqual` requires equal-length buffers, so a length mismatch
 * (the common case — most guesses won't even be the right length) is
 * handled by comparing the expected password against itself instead of
 * returning early: same code path, same rough timing, whether the guess
 * was the wrong length or just the wrong value. Not compared as a hash —
 * unlike Participant tokens, this secret is short and human-chosen, so
 * hashing it wouldn't add anything a config leak doesn't already defeat.
 */
export function verifyHostPassword(candidate: string): boolean {
  if (process.env.NODE_ENV !== "production" && candidate === DEV_PLAYGROUND_HOST_PASSWORD) return true;

  const expected = process.env.HOST_PASSWORD;
  // Misconfigured deployment fails closed: no HOST_PASSWORD set means no
  // one can create a game, not "anyone can."
  if (!expected) return false;

  const expectedBuf = Buffer.from(expected);
  const candidateBuf = Buffer.from(candidate.length === expected.length ? candidate : expected);
  const matches = timingSafeEqual(expectedBuf, candidateBuf);
  return matches && candidate.length === expected.length;
}
