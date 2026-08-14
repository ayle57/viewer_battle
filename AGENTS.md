# AGENTS.md — ViewerBattle

Conventions for anyone (human or AI) working on this codebase. The
architecture is locked (see `docs/architecture.md` once it exists) — do not
silently change it. If a real, measured problem requires deviating from
something documented here, say so explicitly and ask before doing it.

## What this project is

Single Next.js application (App Router) with a custom Node entrypoint
(`src/server/server.ts`) that attaches Socket.IO to the same `http.Server`.
Not a monorepo, not a separated frontend/backend. See the architecture
proposal for the full reasoning; this file is about *how to work in the
code*, not *why it's shaped this way*.

- **tRPC** — request/response only: CRUD, admin, auth, session/content
  management. Lives in `src/server/trpc`.
- **Socket.IO** — all realtime: chat, game actions, timers, drawing,
  presence. Lives in `src/server/sockets`.
- Never duplicate business logic between the two — shared logic goes in
  `src/domain`, called by both.

Do not reintroduce Redis, a message queue, a second backend process, or
SSE-based realtime without a concrete, measured reason — these were
deliberately evaluated and rejected. If one seems necessary, say so and ask
first.

## Folder boundaries

```
src/
  domain/   Game Kernel — pure functions, zero I/O, zero React/Next imports
  ui/       UI Component Kernel — primitives + ViewerBattle components
  server/   Prisma, auth, tRPC routers, Socket.IO handlers
  app/      Next.js routes (host / player / display / dev)
```

Enforced by `eslint.config.mjs` (`no-restricted-imports`), not just
convention:
- `src/domain/**` must not import from `server`, `app`, or `ui`.
- `src/ui/**` must not import from `server` or `app`.

If ESLint blocks an import, that's a signal the code is in the wrong
folder — move it, don't suppress the rule.

## Custom server constraints (verified, not assumed — see below)

`src/server/server.ts` exists for one reason: Socket.IO needs a raw
`http.Server` to attach to, which a Next.js Route Handler cannot provide.
Keep this file minimal — wiring only.

| Context | Behavior | Notes |
|---|---|---|
| `pnpm dev` (`tsx watch src/server/server.ts`) | Works, Fast Refresh included | `next({ dev: true }).prepare()` sets up Next's own dev compiler internally. Confirmed: editing `src/app/**` files (pages, route handlers) reloads via Next's Fast Refresh with **no** process restart. Editing files in `server.ts`'s own import graph (`server.ts`, `src/server/sockets/*`, `src/server/logger.ts`) **does** trigger a full `tsx watch` restart (new PID) — this is correct and expected, not a bug. |
| `pnpm build` (`next build`) | Works | Not using `output: "standalone"` — see below. |
| `pnpm start` (`tsx src/server/server.ts`, `NODE_ENV=production`) | Works | `tsx` must be a **production** dependency, not dev — we run TypeScript directly in prod on purpose (no separate compile step for the server file). |
| Docker | Works | See Dockerfile comments for the full multi-stage reasoning. |
| Caddy | Works, zero WebSocket-specific config | A single `reverse_proxy app:3000` handles both normal HTTP and the Socket.IO `/socket.io` upgrade — Caddy detects the `Upgrade` header automatically. |

**Why no `output: "standalone"`:** standalone output generates its own
minimal `server.js` meant to *replace* `next start` — it doesn't
automatically trace a custom server entrypoint. Rather than hand-wire
standalone tracing around `server.ts`, the Docker runner stage ships full
production `node_modules` instead. Larger image, simpler and more
predictable build. Revisit only if image size becomes a measured problem.

## Real dependency/version gotchas found during Phase 0

These were discovered by actually running things, not by inspection — keep
this list updated when new ones surface.

- **TypeScript pinned to `6.0.3`, not `latest`.** `typescript@7.x` breaks
  `typescript-eslint` (used by `eslint-config-next`) as of this writing.
- **ESLint pinned to `9.39.5`, not `latest`.** `eslint@10.x` breaks
  `eslint-config-next`'s bundled `typescript-eslint@8.46` internally
  (`scopeManager.addGlobals is not a function`).
- **`tsx` and `prisma` (the CLI) are production dependencies**, not dev —
  `tsx` because we run `server.ts` directly in prod, `prisma` because
  `docker compose exec app pnpm exec prisma migrate deploy` needs the CLI
  present inside the running container at deploy time.
- **Prisma 7's default generator (`prisma-client`) requires an explicit
  driver adapter** (`@prisma/adapter-pg` + `pg`) — it no longer reads
  `DATABASE_URL` implicitly. See `src/server/db/client.ts`.
- **`next build` imports every route handler module** to collect page
  data, which runs our Prisma client's module-scope initialization. It
  needs *a* `DATABASE_URL` to exist at build time (no query actually
  runs) — the Docker builder stage sets a harmless placeholder for this
  reason. Don't remove it without replacing the underlying eager
  initialization with a lazy one.
- **`pnpm-workspace.yaml` exists despite this not being a workspace.** It's
  the only place `pnpm approve-builds` persists the allowlist of packages
  permitted to run postinstall scripts (Prisma engines, esbuild). Without
  it, `pnpm install` silently skips those scripts and Prisma's engine
  binaries never get installed. Must be copied into every Docker stage
  that runs `pnpm install`, alongside `package.json`/`pnpm-lock.yaml`.
  `packageManager` in `package.json` must be an **exact** version
  (`pnpm@11.21.0`), not a semver range — `corepack` inside the container
  rejects ranges.
- **Postgres 18+ images changed their expected volume mount.** Mount the
  named volume on `/var/lib/postgresql` (the parent directory), not
  `/var/lib/postgresql/data` — the image now refuses to start under the
  old convention.
- **`node:22-slim` has no OpenSSL.** Prisma's engine needs it to detect
  which binary variant to use; install it explicitly in the base Docker
  stage or Prisma silently guesses and prints a warning on every run.
- **Neither `tsx` nor Next populate `process.env` from `.env` early enough
  for our custom server entrypoint.** `next build`/`next dev` load `.env`
  themselves, but only once `next()` boots — anything our own code imports
  before that (e.g. `src/server/db/client.ts`, transitively required by
  `createSocketServer`) runs first and sees an empty `process.env`.
  `src/server/server.ts` imports `dotenv/config` as its first line to fix
  this for native `pnpm dev`/`pnpm start`. `dotenv` is a **production**
  dependency for this reason. Safe in Docker: `.env` is dockerignored, so
  the import no-ops there and docker-compose's directly-injected env vars
  are used untouched (dotenv never overwrites an already-set variable).

## Session invariants (locked)

These are real constraints, not UI hints — enforced server-side, several
of them by Postgres itself, not just application code. Changing any of
them is a product decision, not a refactor.

- **Exactly 1 HOST per session.** Enforced by a hand-written partial
  unique index (`CREATE UNIQUE INDEX ... ON "Participant"("sessionId")
  WHERE role = 'HOST'`) — not expressible via `@@unique` in the Prisma
  schema DSL, so it's raw SQL in the migration, not something
  `prisma migrate diff` will ever regenerate on its own. See the comment
  block at the top of `prisma/schema.prisma`.
- **Exactly 2 teams, TEAM_A and TEAM_B** — not dynamic/configurable teams.
- **Max 2 players per team (4 total).** Enforced by
  `@@unique([sessionId, role, seat])` on `Participant`. `seat` (1 or 2) is
  assigned inside the join transaction; NULL is never equal to NULL in a
  unique index, so HOST/DISPLAY rows (`seat: null`) never collide with
  each other through this constraint — it only ever restricts
  TEAM_A/TEAM_B. `src/domain/session/limits.ts`'s `MAX_PLAYERS_PER_TEAM`
  is documentation/application-side reflection of this number, not the
  enforcement — bumping the constant alone does NOT change the real
  limit, the migration has to change too.
- **Unlimited DISPLAY connections tolerated on purpose** (OBS + dev
  workflows both want to open more than one) — never counted as a
  player, never seat-limited.
- **A participant is one role for its whole life.** `Participant.role` is
  a single non-nullable column; there's no multi-role participant by
  construction. `session.join` treats an existing valid token for the
  same session as a reconnect (idempotent — same seat, no duplicate row)
  rather than a second join.
- **What's honestly NOT enforced:** "the same human can't hold two
  different roles in one session" only holds at the level of a single
  token — if a client already holds a token for a session and tries to
  join again, they get back their existing seat (see above). Nothing
  stops a genuinely fresh join attempt (no token, or a token from a
  different session) from claiming a second seat, because there is no
  persistent "person" identity (account, device fingerprint) to link the
  two attempts — only tokens. Don't build workarounds for this in the
  playground; it needs real accounts to close for real, which is out of
  scope for now.
- **Lifecycle: `CREATED -> ACTIVE -> FINISHED`.** `CREATED` on
  `session.create`; moves to `ACTIVE` on the first successful join;
  `FINISHED` only via `session.finish` (HOST-only). No `CLOSED`/`EXPIRED`
  — nothing produces those transitions today; don't add states with no
  way to reach them, add them when a real trigger shows up (e.g.
  abandoned-session cleanup).
- **Races are broken by Postgres constraints, not application locking.**
  `src/server/db/participant.ts`'s `joinSession` does a capacity
  pre-check for a friendly error in the common case, but under READ
  COMMITTED (Postgres's default) two concurrent joins CAN both pass that
  pre-check — whichever `INSERT` loses hits the unique constraint (P2002)
  and gets converted to the same `SessionError`. The pre-check is an
  optimization, not the safety mechanism; see the tests under
  `describe("concurrency", ...)` in `tests/integration/session.test.ts`
  for exactly what this guarantees (two simultaneous joins for the last
  seat, two simultaneous HOST joins, four-way team races, ...).
- **One identity resolution, shared by tRPC and Socket.IO.**
  `src/server/auth/tokenIdentity.ts` -> `resolveParticipantByToken`
  (`src/server/db/participant.ts`) is the only place a token gets turned
  into an identity. Socket.IO's auth middleware and any authenticated
  tRPC procedure both call `resolveIdentity` (`src/server/auth`) — the
  capacity/role rules and the token lookup live in exactly one place.
- **Explicit business error codes, not generic errors.**
  `SessionErrorCode` (`src/domain/session/errors.ts`):
  `SESSION_NOT_FOUND`, `SESSION_CLOSED`, `HOST_ALREADY_CONNECTED`,
  `TEAM_FULL`, `INVALID_TOKEN`, `FORBIDDEN`. tRPC exposes this as
  `error.data.sessionErrorCode` (`src/server/trpc/errors.ts`); Socket.IO
  exposes it as `connect_error.message` and `connect_error.data.code`
  (`src/server/sockets/chat.ts`). No separate `SESSION_FULL` code — every
  real "session is full" case is actually one of `TEAM_FULL` or
  `HOST_ALREADY_CONNECTED`; a generic code on top would just be redundant
  with a more specific one that already fired.
- **Tokens: one scheme for all four roles**, not a separate cookie
  mechanism for Host. Opaque, `randomBytes(32)`, hashed with SHA-256
  before storage (`src/server/auth/token.ts`) — a fast hash is correct
  here (unlike a password hash) because the token already has 256 bits
  of entropy; there's nothing for a slow hash to defend against. This is
  a deliberate simplification: Host could get a cookie-based transport
  later without touching identity resolution at all, since that's
  already isolated behind `resolveIdentity`.

## Phase 0 spike — removed

The infrastructure-only spike code (`SpikeCheck` model, `health.check`
procedure, `spike:*` socket events, `SPIKE_TOKEN` auth, `/dev/spike`, and
their tests) has been removed. The patterns it proved — custom server +
Socket.IO, `io.use()` auth middleware, room-scoped broadcast, a real
Prisma/Postgres round-trip, Docker/Caddy config — are preserved and now
live in the real chat vertical slice (`src/server/sockets/chat.ts`,
`src/domain/chat/`, `tests/integration/chat-socket.test.ts`). Copy that
shape for new realtime features rather than re-deriving it.

## Commands

```
pnpm dev              # dev server (tsx watch + Next Fast Refresh)
pnpm build && pnpm start   # production build + run, natively
pnpm test             # vitest, once
pnpm typecheck        # tsc --noEmit
pnpm lint             # eslint .
pnpm db:migrate       # prisma migrate dev (local)
pnpm db:deploy        # prisma migrate deploy (production/Docker)

docker compose up --build -d
docker compose exec app pnpm exec prisma migrate deploy
docker compose logs app --no-color
```
