# Local development, one word at a time. `make` (or `make help`) lists it all.
#
# Every target is a thin wrapper around a `pnpm` script or a command already in
# docs/runbooks/local.md, which explains what each one does and why. Change the
# command there, or in package.json, and this follows; nothing here should be
# the only place a command is written down.

SHELL := /bin/bash
.DEFAULT_GOAL := help

PNPM     ?= $(shell command -v pnpm >/dev/null 2>&1 && echo pnpm || echo corepack pnpm)
SUPABASE := node_modules/.bin/supabase
DB_URL   := postgresql://postgres:postgres@127.0.0.1:54322/postgres
ENV_FILE := apps/app/.env.local

# `make logs SINCE=30m` looks further back; `make logs FOLLOW=` prints and exits.
# Metro (`dev`), the live export (`dev-live`, the live e2e suite) and the smoke suite.
APP_PORTS := 8081 8082 8083

SINCE  ?= 10m
FOLLOW ?= -f

.PHONY: help setup dev dev-live dev-down web up down restart reset nuke status env \
	logs logs-errors logs-db logs-auth logs-api psql sql limits mail studio \
	gen types build check test test-unit test-db test-live test-smoke lint typecheck format

help: ## List every target
	@awk 'BEGIN {FS = ":.*## "} /^[a-z-]+:.*## / {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# --- Getting going ------------------------------------------------------------

setup: ## First run: Corepack, dependencies, packages built, stack up, app env written
	corepack enable
	$(PNPM) i
	$(PNPM) build
	$(MAKE) up
	$(MAKE) env

dev: up env build ## Stack up, env written, then the web app on http://localhost:8081 (Metro, live reload)
	$(PNPM) dev:web

dev-live: up ## A production-style export against the stack, on http://localhost:8082 (what the live e2e suite serves)
	node scripts/e2e-live-serve.mjs 8082

dev-down: ## Stop every local environment: the app servers on 8081/8082/8083, then the stack (data kept)
	@for port in $(APP_PORTS); do \
		pids=$$(lsof -nP -t -iTCP:$$port -sTCP:LISTEN -c node 2>/dev/null); \
		if [ -n "$$pids" ]; then kill $$pids && echo "stopped the app server on :$$port"; fi; \
	done
	@if $(SUPABASE) status >/dev/null 2>&1; then $(PNPM) db:stop; else echo "the stack was not running"; fi

web: ## The web app on :8081 without touching the stack
	$(PNPM) dev:web

env: ## Write apps/app/.env.local from the running stack (otherwise the app runs on fixtures)
	@$(SUPABASE) status -o env 2>/dev/null \
		| sed -n 's/^API_URL=/EXPO_PUBLIC_SUPABASE_URL=/p; s/^ANON_KEY=/EXPO_PUBLIC_SUPABASE_ANON_KEY=/p' \
		> $(ENV_FILE)
	@echo 'EXPO_PUBLIC_APP_ORIGIN=http://localhost:8081' >> $(ENV_FILE)
	@echo "wrote $(ENV_FILE) (restart the dev server if it was running)"

# --- The stack ----------------------------------------------------------------

up: ## Start the local Supabase stack (no-op if it is already up)
	@$(SUPABASE) status >/dev/null 2>&1 || $(PNPM) db:start

down: ## Stop the stack, keeping its data
	$(PNPM) db:stop

restart: ## Stop and start the stack (needed after a new Edge Function or a new packages/*/dist file)
	$(PNPM) db:stop
	$(PNPM) db:start

reset: ## Fresh seed data: re-runs every migration and supabase/seed.sql
	$(PNPM) db:reset

nuke: ## Stop the stack and throw its data away
	$(SUPABASE) stop --no-backup

status: ## The stack's URLs and keys
	$(SUPABASE) status

# --- Logs ---------------------------------------------------------------------

logs: ## Edge Function logs, one JSON line per request (SINCE=10m, FOLLOW= to not follow)
	docker logs $(FOLLOW) --since $(SINCE) supabase_edge_runtime_circles

logs-errors: ## Only the failed Edge Function requests
	@docker logs $(FOLLOW) --since $(SINCE) supabase_edge_runtime_circles 2>&1 \
		| grep --line-buffered '"level":"error"' || echo "no failed requests in the last $(SINCE)"

logs-db: ## Postgres logs
	docker logs $(FOLLOW) --since $(SINCE) supabase_db_circles

logs-auth: ## Auth logs: sign-in codes, anonymous sessions
	docker logs $(FOLLOW) --since $(SINCE) supabase_auth_circles

logs-api: ## API gateway: every request and its status
	docker logs $(FOLLOW) --since $(SINCE) supabase_kong_circles

# --- The database -------------------------------------------------------------

psql: ## A psql shell on the local database
	psql $(DB_URL)

sql: ## Run one statement: make sql Q="select count(*) from public.circles"
	@test -n "$(Q)" || { echo 'usage: make sql Q="select …"'; exit 1; }
	psql $(DB_URL) -c "$(Q)"

limits: ## Clear the rate limits ("Too many tries" locally)
	psql $(DB_URL) -c "delete from jobs.rate_counters"

mail: ## Latest captured emails; make mail TO=someone@example.com for their sign-in code
	$(PNPM) mail $(TO)

studio: ## Open Supabase Studio and Mailpit in the browser
	open http://127.0.0.1:54323
	open http://127.0.0.1:54324

# --- Generated code -----------------------------------------------------------

gen: ## Regenerate SQL functions into their migration, then the database types
	$(PNPM) gen:functions
	$(PNPM) db:reset
	$(PNPM) gen:types

types: ## Regenerate packages/contracts/src/db.generated.ts from the running database
	$(PNPM) gen:types

build: ## Build the shared packages (Edge Functions and the app read their dist)
	$(PNPM) build

# --- Checks -------------------------------------------------------------------

check: up ## Everything CI runs, in CI's order (about ten minutes)
	$(PNPM) check

test: test-unit ## Unit tests (no stack needed)

test-unit: ## Vitest across packages, app and functions
	$(PNPM) test:unit

test-db: up ## Reset the database, then pgTAP
	$(PNPM) db:test

test-live: up ## The live e2e suite in three user agents; make test-live G="part of a name"
	$(PNPM) test:e2e:live $(if $(G),-g "$(G)",)

test-smoke: ## The fixture-mode e2e suite (no stack)
	$(PNPM) test:e2e:smoke

lint: ## ESLint
	$(PNPM) lint

typecheck: ## Every tsconfig, the app's included
	$(PNPM) typecheck

format: ## Prettier, writing
	$(PNPM) format
