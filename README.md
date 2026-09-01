# ViewerBattle

An interactive **2v2 gameshow platform** for livestreams. Two teams of two
compete across a run of games while a Host controls the show in real time
and the scoreboard goes straight onto the stream via OBS.

Webcams are handled separately (VDO.Ninja + OBS).

## Games

All seven are live:

1. **Mini Jeopardy** — host-picked categories and questions; buzz, answer, steal.
2. **GeoGuessr** — one shared map; place a pin, lock it, closest wins the round.
3. **Drawing** — one player sketches a secret word against a timer; the host judges the guess.
4. **Guess the Music** — a track plays for everyone at once; buzz first and name it.
5. **Guess the Game** — a game's own Steam reviews are revealed one at a time; buzz and name it.
6. **Guess the Price** — an item is shown; buzz and type your price guess.
7. **Scoreboard** — a content-free scoreboard for anything played outside the app (Jackbox & co.).

New formats slot in without a schema change — see `src/domain/game/registry.ts`.

## Quick start

```bash
pnpm install
cp .env.example .env          # then edit DATABASE_URL + HOST_PASSWORD
pnpm db:deploy                # apply migrations to the database in DATABASE_URL
pnpm dev                      # http://localhost:3000
```

Create your operator account and promote it:

```bash
# 1. open http://localhost:3000/account and register a username + password
# 2. then:
pnpm grant-admin <that-username>
```

That account can now open `/host` (run games) and `/host/content` (Content
Studio + Admin panel, also reachable with the `HOST_PASSWORD` from `.env`).

**Full walkthrough — content, OBS setup, moderation, deployment: see [`SETUP.md`](./SETUP.md).**

## Routes

| Route | Who | What |
| --- | --- | --- |
| `/` | anyone | Landing page |
| `/account` | anyone | Register / log in / stats |
| `/host` | operator | Run a show (needs an admin account) |
| `/host/content` | operator | Content Studio + Admin panel (word filter, accounts, stats) |
| `/player` | viewers | Join a game as Team A / Team B |
| `/display` | OBS | The on-stream scoreboard (`/display?code=XXXXXX&name=OBS` auto-joins) |

## Tech

Next.js (App Router) + React + TypeScript, a custom server entrypoint
attaching Socket.IO for realtime, PostgreSQL via Prisma, pnpm. Single app,
not a monorepo. See `AGENTS.md` for working conventions and constraints.

## Scripts

```
pnpm dev            pnpm build          pnpm start
pnpm test           pnpm lint           pnpm typecheck
pnpm db:migrate     pnpm db:deploy      pnpm db:generate
pnpm grant-admin <username> [--revoke] | --list
```

Docker (Caddy + app + Postgres): `make docker-up`, `make docker-migrate`.
See the `makefile` for the full list.

## License

Private project — all rights reserved.
