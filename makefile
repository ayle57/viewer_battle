.DEFAULT_GOAL := help

.PHONY: help install dev kill-port build start test test-watch lint typecheck check \
        db-generate db-migrate db-deploy \
        docker-build docker-up docker-down docker-reset docker-logs docker-migrate

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

# --- app (native, no Docker) ---

install: ## Install dependencies
	pnpm install

kill-port: ## Kill whatever's listening on :3000 (stale/orphaned dev server)
	@pid=$$(lsof -ti:3000 2>/dev/null); \
	if [ -n "$$pid" ]; then \
		echo "Killing process on :3000 via lsof ($$pid)"; \
		kill -9 $$pid 2>/dev/null; \
	else \
		echo "lsof found nothing on :3000"; \
	fi
	@fuser -k -n tcp 3000 2>/dev/null && echo "fuser killed something on :3000" || echo "fuser found nothing on :3000"
	@sleep 1

dev: kill-port ## Start the dev server (Next.js + Socket.IO, hot reload)
	pnpm dev

build: ## Production build
	pnpm build

start: ## Run the production server locally (after `make build`)
	pnpm start

test: ## Run the test suite once
	pnpm test

test-watch: ## Run tests in watch mode
	pnpm test:watch

lint: ## Lint the codebase
	pnpm lint

typecheck: ## Type-check without emitting
	pnpm typecheck

check: lint typecheck test ## Run lint + typecheck + tests together

# --- database (native, against the Postgres in DATABASE_URL) ---

db-generate: ## Regenerate the Prisma client after a schema change
	pnpm db:generate

db-migrate: ## Create and apply a local dev migration
	pnpm db:migrate

db-deploy: ## Apply pending migrations without creating new ones (prod/Docker)
	pnpm db:deploy

# --- docker (Caddy + app + Postgres) ---

docker-build: ## Build the app image only
	docker compose build

docker-up: ## Build (if needed) and start the full stack in the background
	docker compose up --build -d

docker-down: ## Stop the stack, keep data
	docker compose down

docker-reset: ## Stop the stack AND wipe volumes (fresh Postgres/Caddy state)
	docker compose down -v

docker-logs: ## Follow the app container's logs
	docker compose logs -f app

docker-migrate: ## Apply migrations inside the running app container
	docker compose exec app pnpm exec prisma migrate deploy
