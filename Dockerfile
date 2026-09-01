# syntax=docker/dockerfile:1

# NOTE on why this is 4 stages and NOT `output: "standalone"`:
# we run a custom server (src/server/server.ts) to attach Socket.IO to the
# same http.Server as Next.js. Standalone output produces its own minimal
# server.js designed to replace ours, and doesn't automatically trace our
# custom entrypoint. Rather than hand-wire standalone tracing around a
# custom server, we ship full production node_modules. Larger image,
# simpler and more predictable build — see AGENTS.md "Custom server
# constraints" for the trade-off and when to revisit it.

FROM node:22-slim AS base
# node:22-slim has no OpenSSL — Prisma's query engine needs it to detect
# which engine binary variant to use, and silently falls back to a guessed
# version without it (works, but prints a warning every run).
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

# ---- deps: install every dependency (build needs devDependencies too) ----
# pnpm-workspace.yaml is copied even though this is a single app, not a
# workspace: it's the only place `pnpm approve-builds` persists the
# allowlist of packages allowed to run postinstall scripts (Prisma, esbuild,
# ...). Without it, pnpm silently skips those scripts and Prisma's engine
# binaries never get installed.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ---- builder: generate the Prisma client and run next build ----
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm exec prisma generate
# `next build` imports every route handler module to collect page data,
# which runs our Prisma client's module-scope initialization and requires
# *a* DATABASE_URL to exist — no query actually runs at build time, so this
# placeholder never needs to point at a real database. The real value is
# injected at container runtime via docker-compose.yml.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
RUN pnpm build

# ---- runner: production image, prod dependencies only ----
FROM base AS runner
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
# The custom server runs from source via tsx at runtime (see the top-of-
# file note on why this isn't `output: "standalone"`), so it needs the
# whole `src` tree on disk to resolve its `@/domain`, `@/server`, … path
# imports — not just `src/server`. `scripts/` is here for
# `pnpm grant-admin` inside the container.
COPY --from=builder /app/src ./src
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json

EXPOSE 3000
CMD ["pnpm", "exec", "tsx", "src/server/server.ts"]
