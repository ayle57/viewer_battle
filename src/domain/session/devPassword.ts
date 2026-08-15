/**
 * Fixed, publicly-known credential — never a secret — accepted by
 * `verifyHostPassword` (src/server/auth/hostPassword.ts) ONLY outside
 * production. What `/dev/session`, `DemoGamePanel`'s Quick Demo, and
 * `FullGameTest` send instead of asking a developer to type the real
 * `HOST_PASSWORD` before every one-click test run. A plain shared
 * constant, not I/O, so it lives here (importable by both src/server and
 * src/app) rather than being duplicated at each dev call site or reached
 * across the app -> server boundary those layers don't otherwise cross.
 * Never a bypass in a real deployment: `pnpm start`/Docker both set
 * `NODE_ENV=production` (see src/server/server.ts, Dockerfile).
 */
export const DEV_PLAYGROUND_HOST_PASSWORD = "dev-playground";
