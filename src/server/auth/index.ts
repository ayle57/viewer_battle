export type { SocketIdentity, IdentityResolver } from "./identity";

/**
 * Single swap point: the active identity resolver used by every socket
 * feature. Currently the dev-only stand-in (see devIdentity.ts) — replace
 * this one export with a real token-based resolver when Phase 1's next
 * step (sessions -> real tokens) lands. Same `IdentityResolver` signature,
 * so nothing importing `resolveIdentity` needs to change.
 */
export { resolveDevIdentity as resolveIdentity } from "./devIdentity";
