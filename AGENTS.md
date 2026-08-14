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
