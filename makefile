.DEFAULT_GOAL := help

.PHONY: help install dev build start test test-watch lint typecheck check \
        db-generate db-migrate db-deploy \
        docker-build docker-up docker-down docker-reset docker-logs docker-migrate

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

# --- app (native, no Docker) ---

install: ## Install dependencies
	pnpm install

dev: ## Start the dev server (Next.js + Socket.IO, hot reload)
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
