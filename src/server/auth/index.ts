export type { SocketIdentity, IdentityResolver } from "./identity";

/**
 * Single swap point: the active identity resolver used by every socket
 * feature and any authenticated tRPC procedure. Now the real one — see
 * tokenIdentity.ts. (The dev-only stand-in that used to be here,
 * devIdentity.ts, is gone: /dev/session's `session.join` now issues real
 * tokens the same way the eventual production join flow will.)
 */
export { resolveTokenIdentity as resolveIdentity } from "./tokenIdentity";
