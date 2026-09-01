# Security posture

A summary of how ViewerBattle handles authentication, input, and the
usual web risks — and where the deliberate limits are. Written for
whoever operates and reviews the deployment.

## Threat model

One operator runs one show at a time for their own community. It is
**not** a multi-tenant SaaS. "Players" are stream viewers who join a
short-lived game; they are semi-trusted. The assets worth protecting are:
the operator's control of a live show, prepared content, and viewer
account stats. There is **no PII, no payment data, no email**.

## Identity & auth

| Secret | Scheme | Notes |
| --- | --- | --- |
| Participant token (host / player / display) | 256-bit random, SHA-256 at rest | Issued at join, never stored in plaintext. One per seat. |
| Session code | 6 chars, CSPRNG (`crypto.randomInt`) | Human-typeable. Rotatable by the host; auto-rotates on a kick. |
| Host recovery key | ~2^60, CSPRNG | Shown once at session create; recovers a lost host token for that one session. |
| Content Studio / Admin (`HOST_PASSWORD`) | env var, `timingSafeEqual`, fails closed if unset | Single shared operator secret. Gates content management + the admin panel. |
| User account password | scrypt (async), 16-byte salt, `timingSafeEqual` | **Low-stakes by design** — 4-char minimum, "throwaway password" is the advice. Accounts track stats only; they are not a security boundary. |
| Admin (`User.isAdmin`) | DB flag, CLI-only (`pnpm grant-admin`) | Gates `/host` game hosting. Not settable through any API a viewer can reach. |

- **Authorization** is re-derived from the token on every tRPC call and
  every socket action — no trust in client-sent role/identity. Game
  actions have their `by` field overwritten server-side with the socket's
  resolved role; the game engine then enforces per-role rules.
- Content Studio queries filter on the token's own `hostId` — IDOR-safe
  (covered by integration tests).
- No cookies for auth → **CSRF is not applicable** (all auth is bearer
  tokens in the request body / `Authorization` header).

## Input handling

- **XSS**: React auto-escaping throughout; **no `dangerouslySetInnerHTML`
  anywhere**. Chat messages and display names render as text.
- **SQL injection**: Prisma only, fully parameterised. No raw SQL in the
  app. (`scripts/grant-admin.ts` uses the Prisma client, not string SQL.)
- **File uploads** (`/api/content/*-assets`): operator-token gated,
  extension whitelist (`.jpg/.png/.webp/.avif` — no SVG), MIME whitelist,
  size caps (40 MB maps / 20–25 MB others), filename sanitised + random
  suffix, path-traversal blocked (covered by tests). Files are written
  as-is (no re-encode) and served from `public/` — safe because the
  extension whitelist can't carry active content. **Not** magic-byte
  sniffed; a compromised `HOST_PASSWORD` could write a non-image with an
  image extension (inert, but noted).
- **Chat word filter** regexes are built from operator-managed strings
  and capped/anchored — no ReDoS (verified: 4.5 KB hostile input, <10 ms).

## Response headers

`next.config.ts` sets, on every response: `Content-Security-Policy`
(blocks off-origin scripts/frames/objects; `frame-ancestors 'none'`),
`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy`, `Permissions-Policy`. HSTS is added by Caddy on a real
domain (see `Caddyfile`).

## Deliberate limits / residual risk

- **No rate limiting** anywhere (login, session join, chat, `HOST_PASSWORD`
  sign-in). Brute-forcing a specific 4-char account password is feasible;
  session-code scanning to find a live show is possible. Mitigations: put
  the app behind a proxy/WAF with basic rate limiting; treat accounts as
  disposable. Adding app-level limiting is a known follow-up.
- **`session.getState` is public** given a code — returns the roster
  (display names, connection state, scores). Those are on-stream anyway;
  low sensitivity.
- **Anyone with a live code can join as `DISPLAY`** (by design — OBS is
  unauthenticated). `DISPLAY` is read-only except one action: "Start next
  game" on the between-games screen — and that is now allowed **only while
  no Host is connected** (its intended "the Host stepped away" case), with
  sample content only, never during a running game. So a stray `DISPLAY`
  join can't force anything while you're at the controls. If a code leaks
  mid-show anyway, rotate it (`/host` → "New code").
- `/dev/*` routes are **404'd in production** (`NODE_ENV`).
- User accounts, again: **not a security boundary** — no email, no reset,
  4-char passwords allowed on purpose.

## Operational

- Set a long random `HOST_PASSWORD`. It's the one secret that matters.
- Keep `NODE_ENV=production` in the deploy (docker-compose does) — it
  disables dev routes and tRPC stack traces in error responses.
- `.env` is gitignored; never commit real secrets.
- `pnpm audit --prod` is clean.
- Rotate the session code if you suspect it leaked mid-show.
