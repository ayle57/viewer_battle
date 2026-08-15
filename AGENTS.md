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
- **Host recovery: a one-time recovery key, not account credentials.**
  `Session.hostKeyHash` (SHA-256, same reasoning as the token) is
  generated in `createSession` and returned as plaintext exactly once, in
  `session.create`'s response — never persisted or re-derivable
  afterward. `/host`'s "Reconnect" tab calls `session.reclaimHost`
  (`src/server/db/participant.ts`), which checks the key against the hash
  and rotates the existing HOST `Participant`'s `tokenHash` — it reclaims
  the same seat, it never creates a second one, so the "exactly 1 HOST"
  partial unique index never enters into it. This exists because Host
  identity lives in `sessionStorage`, not `localStorage`
  (`identityStore.ts`) — closing the tab, not just reloading it, loses
  the token for good, and without a recovery path that would permanently
  lock the host out of a session that's still live for every other
  connected participant (a disconnected host doesn't end the session —
  see `isHostConnected`/`HOST_NOT_CONNECTED` above — it only blocks NEW
  joins until someone reclaims the seat). Deliberately session-scoped,
  not a real account system: still just possession of a secret, same
  spirit as every other identity in this app.
- **Creating a session at all is gated behind `HOST_PASSWORD`.** A
  different question from the recovery key above: this one proves "I'm
  allowed to start a show," checked once, at `session.create`
  (`src/server/trpc/router.ts`), before anything is written to Postgres.
  `verifyHostPassword` (`src/server/auth/hostPassword.ts`) compares
  against the single shared secret in `.env`/`HOST_PASSWORD` with
  `timingSafeEqual` — this app runs one specific streamer's show, not a
  multi-tenant platform, so there's no per-user permission to model, just
  "knows the password the operator configured." Fails closed: an unset
  `HOST_PASSWORD` means no one can create a game, not "anyone can."
  Outside production only (`NODE_ENV !== "production"`, the same signal
  `server.ts`'s own `dev` flag already relies on), a second, fixed,
  publicly-known credential — `DEV_PLAYGROUND_HOST_PASSWORD`
  (`src/domain/session/devPassword.ts`) — is also accepted, so
  `/dev/session`, Quick Demo, and `FullGameTest` keep working as one-click
  tools without a developer typing the real password every run; it lives
  in `src/domain/session` (not `src/server`) purely so both the server
  check and the `"use client"` dev components can import the same
  constant without a client bundle reaching into `src/server`.

## Game Kernel contract (locked)

`src/domain/game` is the real core: pure, deterministic, no Prisma, no
Socket.IO, no Next.js, no React. It knows nothing about Session,
Participant, tRPC, or UI components — only game concepts. The server's
job (not built yet) is `load state -> engine.apply() -> persist ->
broadcast`; every engine has to work identically called from a test with
no server or DB running, which is how it's actually tested.

**Shape:** `apply(state, action) -> EngineResult<state, events>` — kept
close to the form proposed going in, with one refinement: errors are a
separate `{ ok: false, error }` branch, not folded into the events array,
because "the action was rejected" and "the action succeeded and here's
what happened" are different things a caller needs to branch on
differently (an error means state didn't change at all; events describe
what changed). See `src/domain/game/kernel.ts` for the exact types
(`GameEngine`, `EngineResult`, `GameError`).

**Hard rules every engine follows** (see kernel.ts's own doc comment for
the enforcement mechanism, this is the summary):
- State is plain JSON-serializable data — no `Date`, `Map`, `Set`, class
  instances, `undefined`. That's the entire persistence story for a
  future `SessionGame.internal_state` JSONB column:
  `JSON.stringify(state)` / `JSON.parse(...)`, nothing custom per engine.
  (No `SessionGame` Prisma model exists yet — out of scope for this
  pass, which is domain-only.)
- No wall-clock reads inside `apply` (`Date.now()`, `setTimeout`). A
  timer-driven engine gets `nowMs` handed to it as part of the action
  (see `timer.ts`) — same state + same action always produces the same
  result, which is what makes an engine replay-safe and testable with
  plain equality instead of fake timers.
- `apply` never throws. It re-validates its `action` argument with zod
  internally regardless of the static `TAction` type, because the real
  caller (a socket/tRPC handler) hands it untrusted JSON — the type is a
  convenience for callers that already validated, not a guarantee `apply`
  itself relies on.
- A rejected action changes nothing. No partial application, ever.

**Concrete engines, not one generic abstraction.** `GameEngine<TState,
TAction, TEvent, TConfig>` (kernel.ts) names the shared SHAPE so
`/dev/game` can treat engines polymorphically — it is a structural
contract, not a base class; nothing about it is inherited or shared at
runtime between engines. Each engine's `apply` is entirely its own
implementation. Planned split, by actual behavior rather than a forced
common abstraction:
- **ManualScoreEngine-shaped** (host manually awards points, no board):
  Guess the Music, Top 5, Steam Ratings, Story Time.
- **BoardQuestionEngine** (categories x questions, reveal, judge): Mini
  Jeopardy — the first one built, see below.
- **DualSubmissionEngine-shaped** (both teams submit something, then
  compared/judged): GeoGuessr-like, Guess the Price.
- **TimedDrawingEngine-shaped**: Drawing.

Only `BoardQuestionEngine` is implemented so far. The others are names
for where real behavior will land, not stubs — don't create empty
placeholder engines ahead of actually building them.

**Shared pure helpers** (`src/domain/game/`, used because they're
genuinely identical across engines, not to force uniformity):
- `scoring.ts` — `Scoreboard` (`Record<TeamRole, number>`), `addScore`,
  `checkFirstToN` (teams at/above a threshold — an engine calls this
  right after applying a score change; since `apply` only ever handles
  one action at a time, "first to N" falls out of "did this update cross
  the line," no ordering/race logic needed), `leadingTeam`.
- `events.ts` — `ScoreChangedEvent`, `GameFinishedEvent`: shapes reused
  across engines whose events genuinely coincide; not mandatory for an
  engine whose events don't fit.
- `timer.ts` — `computeDeadline`/`isExpired`/`remainingMs`, the pattern
  for a pure deadline (time in, time out, no engine reads the clock
  itself). Not used by BoardQuestionEngine v1 (no rule needs a hard
  timer yet) — written now because the pattern needed to exist to answer
  "how would a pure timer work" concretely, and TimedDrawingEngine will
  need it.

### BoardQuestionEngine (Mini Jeopardy) — gameplay decisions

None of these were specified anywhere before this engine; each is the
minimum needed for a real vertical slice, not an assumption about "how
Jeopardy works":

- **The host selects every question** — teams don't pick from the board.
  Keeps v1 free of a "who goes first" mechanic.
- **The buzzed team submits its answer as text (SUBMIT_ANSWER)** — this
  was "no typed submission, teams answer out loud, BUZZ is the whole
  answer"; revised during the Dev Playground stabilization pass because
  the playground needs to exercise the full protocol end-to-end, and a
  verbal answer isn't something a client (or a test) can send. BUZZ still
  gates WHO may answer; SUBMIT_ANSWER is what they answer with, and
  JUDGE_ANSWER now requires a submission to exist first
  (`ANSWER_NOT_SUBMITTED` otherwise) — the host judges what was actually
  sent, not a verbal claim the app never recorded. `submittedAnswer` is
  visible to every role once sent (host, both teams, display) — same as
  speaking it aloud on stream, nothing to hide there; only the reference
  `answer` stays host-only, that redaction is untouched.
- **BUZZ is a real race, JUDGE_ANSWER applies to whoever's buzzed in and
  has submitted.** After an incorrect judgment the other team may still
  buzz (a steal, which clears `submittedAnswer` for the new attempt); a
  team can't buzz twice on the same question. If both teams miss, the
  question auto-closes with no winner — the host doesn't have to
  separately close it (CLOSE_QUESTION still exists as a manual escape
  hatch for dead air / no one buzzing at all).
- **Correct = award the question's points. Incorrect = no penalty.** The
  classic Jeopardy negative-scoring rule is a real, debatable format
  choice, not assumed here — revisit explicitly if the product wants it.
- **The board ends the game** — status flips to `finished` once every
  question has been played (not on a score threshold). Winner is highest
  score; equal scores finish in `"TIE"`.
- **DISPLAY can never submit any action**, same as it can never post
  chat — consistent read-only-everywhere posture for that role.

Actions: `SELECT_QUESTION` (host), `BUZZ` (a team), `SUBMIT_ANSWER` (the
team that buzzed), `JUDGE_ANSWER` (host), `CLOSE_QUESTION` (host). See
`src/domain/game/boardQuestion/types.ts` for the exact zod shapes and
`engine.ts` for the state machine; `engine.test.ts` is the executable
spec of all of the above, including the races/edges (steal, both-miss,
already-played, already-finished, wrong role, wrong phase, judging
before a submission, double-submission).

### /dev/game

Runs the real engine directly in the browser — `src/domain/game` has no
Node-only APIs, so no server round-trip is needed to exercise it for
real. Board content comes from `boardQuestion/fixtures.ts`'s
`sampleBoard`, explicitly fixture data, not real show content. This
stays true once a real persistence layer exists (load/apply/persist/
broadcast on the server) — the engine itself doesn't change, only who
calls it.

## Vertical slice: SessionGame + realtime bridge (locked)

The proof that Game Kernel -> Prisma -> Socket.IO -> Zustand -> UI works
end to end, built against Mini Jeopardy as the reference. The same shape
is meant to carry the other engines later — read this before wiring a
second game in.

**`SessionGame` (prisma/schema.prisma) stores an opaque snapshot, zero
game logic.** `internalState Json` is exactly whatever
`engine.createInitialState`/`engine.apply` produced — the Game Kernel's
"plain JSON, no custom (de)serialization" rule (see "Game Kernel
contract" above) is what makes this column the entire persistence story.
Prisma never branches on what's inside it. A session can have many
SessionGame rows over its life (the product runs several mini-games per
show); there's no unique constraint on `sessionId` and no separate
"active game" pointer — "the current game" is simply the most recently
started row (`src/server/game/service.ts`'s `getCurrentGame`).

**Concurrency is `SessionGame.version` (optimistic), not a DB
transaction wrapping read-apply-write.** A Postgres transaction can't
protect this cycle anyway, since `engine.apply` runs in application code
between the read and the write, not in SQL. The write is
`UPDATE ... WHERE id = ... AND version = <version just read>`; zero rows
matched means someone else's action landed first, and
`applyGameAction` reloads the now-current state and retries the SAME
action from the top (bounded, `MAX_APPLY_ATTEMPTS`). That's why a losing
request gets a real rejection reason from the engine (e.g.
`TEAM_ALREADY_ATTEMPTED`, `WRONG_PHASE`) instead of a generic "conflict,
try again" — see the `describe("concurrency", ...)` blocks in
`tests/integration/game-service.test.ts` for exactly what this
guarantees. No Redis, no in-memory lock — same spirit as Participant's
unique-constraint races.

**`src/server/game/service.ts` is the ONLY Prisma<->Kernel bridge**,
and deliberately knows nothing about Socket.IO — `startGame`,
`applyGameAction`, `getCurrentGame`, `publicStateFor` are plain
async functions, testable (and tested) with no live socket server. Two
callers use them: the `game:action` socket handler
(`src/server/sockets/game.ts`) and the tRPC `game.start` mutation
(`src/server/trpc/router.ts`) — neither duplicates the bridge, both call
the same functions.

**Broadcasting is a separate, explicit step**, not something
`service.ts` does itself, so the bridge stays testable without a real
`io` instance. `src/server/sockets/game.ts` exports
`broadcastGameSnapshot(io, sessionId, gameId, gameKey, state, events)`;
the socket handler calls it after every successful `game:action`, and the
tRPC `game.start` mutation calls it too (via
`src/server/sockets/instance.ts`'s shared `io` reference — see below) so
a client that was already connected before the host clicked "start"
still hears about it, not just on their next reconnect. `gameId` is a
required argument, not optional — it was omitted from the broadcast
payload for a while (only `sendCurrentSnapshot`, the per-socket initial
sync, included it), which meant a socket already connected and already
showing a game had its own `gameId` clobbered to `undefined` by the very
next action broadcast, flipping an in-progress board back to "no game
running" client-side for no real reason. Every `game:state` event, initial
snapshot or broadcast, carries `gameId` — that's the contract now, and
`useGameSocket.ts`'s payload type is non-optional to match.

**`src/server/sockets/instance.ts` stashes the live `io` instance on
`globalThis`, not a plain module-level variable — this bit for real.**
`src/app/api/trpc/[trpc]/route.ts` (under `src/app`, hot-reloaded by
Next's Fast Refresh) and `src/server/server.ts` (its own module graph,
restarted whole by `tsx watch` — see "Custom server constraints" above)
can end up as genuinely different module instances of the same file
after a dev-mode edit to `router.ts`. A plain `let ioInstance` gave each
its own copy: the tRPC side read a variable that was never set and
silently skipped the broadcast (an already-connected client never heard
a game had started — caught by manually testing multiple real tabs
against the running dev server, not by the automated suite, which
spins up its own isolated `http.Server`+Socket.IO pair per test file and
never exercises this specific cross-module-instance path). Fixed the
same way `src/server/db/client.ts`'s Prisma singleton already handles
the identical class of problem: stash it on `globalThis`, which is
actually shared across those instances within one process.

**The Dev Playground's zustand stores (`useGameStore`, `useDevIdentityStore`,
`useDemoGameStore`, `usePresenceStore` — all under `src/app/dev/_shared`)
are pinned to `globalThis` too, same reasoning as `instance.ts` above but
on the client this time.** Found during the "reset mid-game" stabilization
pass: Next's Fast Refresh can re-execute one of these store modules (any
edit to the file itself, or to a file that imports it) WITHOUT unmounting
the component tree that's using it. A plain `create()` there hands out a
brand new store with fresh defaults; the live socket in `useGameSocket.ts`
is sitting in a `useEffect` that never re-ran (its `[token]` dependency
didn't change), so it keeps writing to the OLD store forever while every
re-render reads the NEW one — which nothing is updating anymore. The
board looks like it silently reset to "no game running" and never
recovers short of a full page reload, even though the socket is alive and
the actual game is fine. This can't be reproduced in an automated test
(no bundler HMR runtime exists in Vitest/Node) — it was diagnosed by
tracing the actual failure mode, matched against `instance.ts`'s already-
proven fix for the identical class of bug, and applied the same way:
reuse the same store object across module re-executions by checking
`globalThis` first.

**Visibility rules are game rules, so they live in the engine, not the
bridge.** `GameEngine.toPublicView?(state, viewerRole)` (optional —
see "Game Kernel contract") is what the bridge calls before sending
state to a non-authoring role; `boardQuestion/view.ts`'s `toPublicView`
is Jeopardy's actual rule: HOST sees everything; everyone else never
sees `answer`, and never sees a question's `prompt` until it's the
active question or already played (no reading ahead on the board).
Redacted fields become `""`, not `null`, so the redacted state is still
the exact same `BoardQuestionState` shape — no second, nullable-fields
type needed just for the public view.

**Two Socket.IO rooms per session** (`src/domain/game/rooms.ts`):
`session:<id>:game:host` (HOST only, full state) and
`session:<id>:game:public` (TEAM_A/TEAM_B/DISPLAY, redacted state).
Socket.IO has no "different payload per room member" primitive, so a
redaction that genuinely differed BY team (not needed by Jeopardy, whose
`toPublicView` treats every non-host role identically) would need
per-team rooms instead of one shared "public" room.

**`by` on a game action is never taken from the client.** The socket
handler always overwrites it with the resolved, server-trusted identity
role (`{ ...payload, by: identity.role }`) before it ever reaches
`engine.apply` — a socket can't claim `HOST` by putting it in the
payload. Same posture as Session's tokens: the server decides who you
are, the client doesn't get to assert it.

**Presence (`src/server/sockets/presence.ts`) is transport-layer info,
not gameplay — it stays out of the Game Kernel and out of Prisma.** An
in-memory `Map<sessionId, Map<participantId, socketCount>>`, refcounted
per socket (a participant can hold more than one open tab; presence only
clears once the LAST one disconnects), broadcasting `presence:update` to
both game rooms whenever it changes. Not persisted on purpose — a server
restart legitimately means "everyone just disconnected," unlike game
state, which the whole vertical slice above exists to survive. Powers the
Quick Demo panel's live "N/6 clients connected" indicator.

**Events, not just `game:error`.** `game:action`'s ack carries
`{ ok: false, error }` on rejection (same ack-based pattern
`chat:send` already uses) rather than a separate `game:error` broadcast
— nothing needs a rejection broadcast to a whole room, only the actor
who tried it needs to know.

**`/dev/game` (the pure local Kernel lab, unchanged) and
`/dev/host`/`/dev/player`/`/dev/display` (the real multi-client slice)
are deliberately two different tools, not one replacing the other.**
`/dev/game` still runs the engine directly in the browser with no
session/server round-trip — fast iteration on kernel rules alone. The
real slice needs a joined session (`/dev/session`) in each tab and
exercises the actual Prisma/Socket.IO/tRPC path; open `/dev/session` +
`/dev/host` + `/dev/player` (x2, one per team) + `/dev/display` in five
tabs to watch one real game synchronize.

## Session vs. Game phases (multi-game sessions, locked)

A session outlives any one game — this pass made that real end to end,
without touching the Game Kernel contract or adding a second engine.
Nothing here changes `apply`/`createInitialState`/kernel rules; it's
entirely about what the Prisma/bridge/client layers already do with a
finished game.

**Nothing new happens when a game finishes — the vertical slice already
had the right shape.** `applyGameAction` (`src/server/game/service.ts`)
already flips `SessionGame.status` to `FINISHED` the moment
`engine.apply` returns a state whose generic `status` field is
`"finished"` (`GameStatus`, `src/domain/game/kernel.ts` — every engine
exposes this, not something Jeopardy-specific). It never touches
`Session.status`. `startGame` already refuses a new game only while the
current one is `IN_PROGRESS`, and always builds a brand-new
`engine.createInitialState`, so "start a next game" already meant "fresh
0-0 state, same Participants/tokens, no new Session row" before this pass
— see the `describe("Session vs. Game lifecycle (multi-game session)")`
tests in `tests/integration/game-lifecycle.test.ts`, which lock this
rather than change it. The one real access-control question — "can a new
game be started at all" — was already answered too: `game.start`
(`src/server/trpc/router.ts`) resolves the caller's token first
(`resolveParticipantByToken`), which already throws `SESSION_CLOSED` for
a finished session; `startGame` itself has no session-status awareness
and was never supposed to.

**`SessionPhase` (`src/app/_shared/sessionPhase.ts`) is the entire "new"
piece — a pure, client-side derivation, not a second state machine.**
`deriveSessionPhase({ sessionStatus, gameId, gameStatus })` returns one of
`SESSION_LOBBY | GAME_IN_PROGRESS | GAME_FINISHED | SESSION_FINISHED`
from exactly the three signals that already existed:
`session.getState`'s `status` (already polled every 2s by every product
page), `useGameStore.gameId` (null until a game has ever been created for
this session — never cleared afterward, "the current game" is always the
most recently started one), and `gameState.status` (read generically via
`readGameStatus`, the same `GameStatus` field every engine exposes — this
derivation works for a future second engine with zero changes). Every
Host/Player/Display screen calls this same function on every render
instead of keeping any local `isGameOver`/`hasReturnedToLobby`-shaped
boolean — there's nothing to go stale because nothing is stored, it's
recomputed from whatever the store/query currently hold. `sessionStatus
=== "FINISHED"` wins over everything else on purpose.

**Host's "Back to Lobby" is a local VIEW toggle within `GAME_FINISHED`,
never a claim about which phase the session is in.** `GAME_FINISHED`
itself is real, derived, and — deliberately, per product spec — persists
across a reconnect (a reconnecting client mid-results-screen sees the
finished snapshot, not stuck on a frozen mid-game board, which is what
"reconnect after finish → lobby" is actually guarding against). What
"Back to Lobby" controls is only which of two truthful renderings of that
SAME phase the Host is currently looking at: the full results splash
(winner, scores, the button) or the Lobby shell with a "Previous game"
card. This toggle is scoped to a specific `gameId` (`useState<string |
null>`, compared against the live `gameId`, not a plain boolean) so a
genuinely fresh game always starts back on "not yet acknowledged" — see
`src/app/host/page.tsx`. Player and Display never get this splash or a
button at all; they render the merged Lobby+results view the instant
`GAME_FINISHED` is true, since neither role has anything to decide about
pacing (Display: "Aucun bouton" by product spec; Player: nothing to
control either).

**`PreviousGameCard` (`src/app/_shared/boardQuestion/PreviousGameCard.tsx`)
and `SessionEndedNotice` (`src/app/_shared/SessionEndedNotice.tsx`) are
the two new shared UI pieces**, reused verbatim across Host/Player/Display
rather than three bespoke copies. `PreviousGameCard` reads
`BoardQuestionState.winner`/`.scores` — Jeopardy-specific content, same as
the three board panels already are; only the PHASE it appears in
(`GAME_FINISHED`) is engine-agnostic. `SessionEndedNotice` is the one
screen every role converges on for `SESSION_FINISHED` — identical content
for all three, since "the show is over" is one fact, not three.

**`GameEngine.description` (`src/domain/game/kernel.ts`) and
`listGameDefinitions()` (`src/domain/game/registry.ts`) are the entire
"future-proof registry" piece, deliberately tiny.** `description` is an
optional field alongside the existing `id`/`label`, read by nothing under
`src/domain` or `src/server` — purely a UI convenience for the Lobby's
"Game selection" list. `listGameDefinitions()` projects the registry down
to `{ id, label, description }[]` so a "pick a game" UI never needs to
import `gameEngines` itself (which would also hand it `apply`). Today it
returns exactly one entry; adding a second real engine to `gameEngines`
is the entire change needed for it to show up here too. The Lobby's
"Start Game"/"Start Next Game" button still calls `game.start` with the
literal `gameKey: "board-question"`, not `games[0].id` — the tRPC input
schema is intentionally still `z.literal("board-question")` (Jeopardy is
the only registered game; widening that schema is a real, deliberate
change for whenever a second engine actually exists, not a preemptive one
here).

**Match score: 1 point per game actually won, tallied across every game
a session has run — a small, deliberately engine-agnostic addition, not
a new state machine.** `GameEngine.getWinner?(state)` (kernel.ts,
optional, same shape as `toPublicView`) is the one new hook: it returns
`TeamRole | "TIE" | null` for a finished instance of that engine's game,
nothing else. `src/server/db/session.ts`'s `getSessionState` is the only
caller — it loads every `FINISHED` `SessionGame` row for the session,
calls `getGameEngine(gameKey)?.getWinner?.(internalState)` on each (still
via the registry, `internalState` stays fully opaque, same rule as
`toPublicView`), and tallies wins into `SessionState.matchScore: {
TEAM_A, TEAM_B }` — a TIE, or a game whose engine has no such concept,
credits neither side. No new event, no new socket message, no new
polling loop: every screen that already polls `session.getState` (Host,
Player, Display) gets this for free. Deliberately independent of any
single game's own in-game score (which still resets to 0-0 every game —
see "Vertical slice" above); `src/app/_shared/MatchScore.tsx` is the one
shared presentational component for it, shown once
`matchScore.TEAM_A + matchScore.TEAM_B > 0` so it never appears before
there's an actual match history.

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
