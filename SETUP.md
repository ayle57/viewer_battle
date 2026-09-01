# ViewerBattle — Setup & Operations

Everything you need to get the platform running, put it on stream, and
run a show. Read `README.md` first for the one-paragraph overview.

---

## 1. First run (local)

```bash
pnpm install
cp .env.example .env
```

Edit `.env`:

| Variable | What to put |
| --- | --- |
| `DATABASE_URL` | A PostgreSQL connection string. Any Postgres 15+ works. |
| `PORT` | `3000` is fine. |
| `HOST_PASSWORD` | A long random string. This unlocks the Content Studio / Admin panel. |
| `POSTGRES_PASSWORD` | Only used by Docker Compose — see §5. |

Then:

```bash
pnpm db:deploy      # create the tables in DATABASE_URL
pnpm dev            # http://localhost:3000
```

---

## 2. Create your operator account

The `/host` page (where you actually run games) is gated behind a real
**admin account**. There is no button in the app to grant admin — it's an
operator action, done once from the command line:

```bash
# 1. Open http://localhost:3000/account and register a username + password.
# 2. Promote it:
pnpm grant-admin your-username

# helpers:
pnpm grant-admin --list                # who's an admin
pnpm grant-admin your-username --revoke # take it away
```

Now, signed in as that account, you can open:

- **`/host`** — run a show (create a game, control the board, judge answers).
- **`/host/content`** — Content Studio + Admin panel. Also reachable by typing
  `HOST_PASSWORD` on the sign-in screen there.

You can promote more than one account (co-hosts, a backup).

---

## 3. Prepare content

`/host/content` → pick a game → **Create playlist**.

- **Mini Jeopardy** — categories → questions (prompt, answer, point value).
- **GeoGuessr** — rounds: upload a map image, click the target point, write the question.
- **Drawing** — an ordered list of words + a per-word timer.
- **Guess the Music** — upload audio clips (MP3/WAV/OGG/M4A, ≤25 MB) + the answer.
- **Guess the Game** — a game title, a cover image, and its Steam reviews least-obvious-first.
- **Guess the Price** — an item photo, its real price, and an optional "close enough" margin.
- **Scoreboard** — no content; you name it and award points live.

Every game also ships a **"Default …"** sample you can start immediately
without building anything — good for a dry run. Replace the sample map /
audio / images with your own before a real show (the bundled samples are
placeholders, and the GeoGuessr sample map is a generic stylised map, not
a real place).

A playlist shows **Ready / Not ready** — you can't start a show on an
incomplete one.

---

## 4. On stream (OBS)

Add a **Browser Source** pointing at:

```
https://YOUR-DOMAIN/display?code=SESSIONCODE&name=OBS
```

- Set it to your canvas size (e.g. 1920×1080).
- It **auto-joins** — no clicking. If the show hasn't started yet it waits
  quietly and keeps retrying; if OBS restarts mid-show it reconnects on its own.
- The Display is always dark, regardless of the machine's theme.
- The session code is new every show — update the URL, or add the source fresh each time.

Players join at `https://YOUR-DOMAIN/player`, enter the code, pick a name
and a team (Team A / Team B). Two players per team can hold the buzzers;
extra joiners on a full team watch along. No account needed to play — an
account just tracks their win/loss stats.

Webcams are separate (VDO.Ninja + OBS).

---

## 5. Deploy (Docker)

`docker-compose.yml` runs **Caddy + the app + Postgres**.

```bash
cp .env.example .env         # set HOST_PASSWORD and POSTGRES_PASSWORD
make docker-up               # build + start in the background
make docker-migrate          # apply DB migrations inside the container
docker compose exec app pnpm grant-admin your-username
```

- **TLS / domain**: edit `Caddyfile` — replace `:80` with `your-domain.com { reverse_proxy app:3000 }`. Caddy gets a Let's Encrypt cert automatically.
- **Uploaded GeoGuessr maps** persist in the `geo_maps` Docker volume. That
  volume starts empty, so the bundled sample map won't appear in a Docker
  deploy — upload your own maps from Content Studio (that's what you'd do
  for a real show anyway).
- Postgres data persists in the `postgres_data` volume. `make docker-reset`
  wipes both volumes.

Native (no Docker): `pnpm build` then `pnpm start`, with a Postgres you
manage and a reverse proxy in front. `pnpm db:deploy` for migrations.

---

## 6. Chat moderation (word filter)

`/host/content/admin` → **Chat word filter**.

- Applies to **player** chat only. Host and Display messages are never filtered.
- A blocked word stops the whole message — the sender is told "not sent".
- Matching ignores case, accents, spacing and common letter swaps
  (`c0nn4rd`, `c o n n a r d`).
- It ships **seeded with a default list** (slurs + hard profanity, EN/FR).
  Review it and adjust to your community — add a word in the box, remove one
  with the ✕ on its chip. Changes take effect within ~15 seconds.

---

## 7. Admin panel

`/host/content/admin` also has:

- **Accounts** — every viewer account, their W–T–L record, delete a viewer
  account (the games they played stay in history, just unattributed).
- **Platform stats** — accounts, sessions, games finished.

The operator's own admin account can't be deleted from here (use
`pnpm grant-admin --revoke` first if you really need to).

---

## 8. Health checks

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

All four should pass clean before any deploy.
