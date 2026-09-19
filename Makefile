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
ENV_FILE := apps/app/.env.local

# Every port comes from this checkout's own supabase/config.toml, so the same
# target works here and in a ticket worktree. A worktree made by the
# work-tickets-in-parallel skill renames the project `circles-s<N>` and shifts
# every port by 100 x N; slot 0 is this checkout, on the numbers the runbook
# quotes. `make ports` prints what was worked out.
PROJECT := $(shell sed -n 's/^project_id = "\(.*\)"/\1/p' supabase/config.toml)
SLOT    := $(or $(shell printf '%s' '$(PROJECT)' | sed -n 's/.*-s\([0-9][0-9]*\)$$/\1/p'),0)

API_PORT    := $(shell echo $$((54321 + 100 * $(SLOT))))
DB_PORT     := $(shell echo $$((54322 + 100 * $(SLOT))))
STUDIO_PORT := $(shell echo $$((54323 + 100 * $(SLOT))))
MAIL_PORT   := $(shell echo $$((54324 + 100 * $(SLOT))))
# Metro (`dev`), the live export (`dev-live`, the live e2e suite) and the smoke suite.
WEB_PORT    := $(shell echo $$((8081 + 100 * $(SLOT))))
LIVE_PORT   := $(shell echo $$((8082 + 100 * $(SLOT))))
SMOKE_PORT  := $(shell echo $$((8083 + 100 * $(SLOT))))
APP_PORTS   := $(WEB_PORT) $(LIVE_PORT) $(SMOKE_PORT)

DB_URL   := postgresql://postgres:postgres@127.0.0.1:$(DB_PORT)/postgres
MAIL_URL := http://127.0.0.1:$(MAIL_PORT)
# What a second or third stack leaves out, so it fits in Docker beside this one
# (the same list CI runs without). Slot 0 starts everything.
EXCLUDE  ?= realtime,storage-api,imgproxy,studio,logflare,vector,supavisor

# `make logs SINCE=30m` looks further back; `make logs FOLLOW=` prints and exits.
SINCE  ?= 10m
FOLLOW ?= -f

.PHONY: help ports setup dev dev-live dev-down web up down restart reset nuke status env \
	logs logs-errors logs-db logs-auth logs-api psql sql limits mail studio \
	gen types build check test test-unit test-db test-live test-smoke lint typecheck format

help: ## List every target
	@awk 'BEGIN {FS = ":.*## "} /^[a-z-]+:.*## / {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@echo
	@$(MAKE) --no-print-directory ports

ports: ## Which project and ports this checkout uses
	@echo "$(PROJECT) (slot $(SLOT)) · api $(API_PORT) · db $(DB_PORT) · mail $(MAIL_PORT) · app $(WEB_PORT) · live $(LIVE_PORT)"

# --- Getting going ------------------------------------------------------------

setup: ## First run: Corepack, dependencies, packages built, stack up, app env written
	corepack enable
	$(PNPM) i
	$(PNPM) build
	$(MAKE) up
	$(MAKE) env

dev: up env build ## Stack up, env written, then the web app on http://localhost:$(WEB_PORT) (Metro, live reload)
	$(PNPM) --filter app exec expo start --web --port $(WEB_PORT)

dev-live: up ## A production-style export against the stack, on http://localhost:$(LIVE_PORT) (what the live e2e suite serves)
	node scripts/e2e-live-serve.mjs $(LIVE_PORT)

dev-down: ## Stop every local environment: this checkout's app servers, then its stack (data kept)
	@for port in $(APP_PORTS); do \
		pids=$$(lsof -nP -t -iTCP:$$port -sTCP:LISTEN -c node 2>/dev/null); \
		if [ -n "$$pids" ]; then kill $$pids && echo "stopped the app server on :$$port"; fi; \
	done
	@if $(SUPABASE) status >/dev/null 2>&1; then $(PNPM) db:stop; else echo "the stack was not running"; fi

web: ## The web app on this checkout's port without touching the stack
	$(PNPM) --filter app exec expo start --web --port $(WEB_PORT)

env: ## Write apps/app/.env.local from the running stack (otherwise the app runs on fixtures)
	@$(SUPABASE) status -o env 2>/dev/null \
		| sed -n 's/^API_URL=/EXPO_PUBLIC_SUPABASE_URL=/p; s/^ANON_KEY=/EXPO_PUBLIC_SUPABASE_ANON_KEY=/p' \
		> $(ENV_FILE)
	@echo 'EXPO_PUBLIC_APP_ORIGIN=http://localhost:$(WEB_PORT)' >> $(ENV_FILE)
	@echo "wrote $(ENV_FILE) (restart the dev server if it was running)"

# --- The stack ----------------------------------------------------------------

up: ## Start the local Supabase stack (no-op if it is already up)
	@$(SUPABASE) status >/dev/null 2>&1 && exit 0; \
	if [ "$(SLOT)" = 0 ]; then $(PNPM) db:start; else $(SUPABASE) start -x "$(EXCLUDE)"; fi

down: ## Stop the stack, keeping its data
	$(PNPM) db:stop

restart: ## Stop and start the stack (needed after a new Edge Function or a new packages/*/dist file)
	$(PNPM) db:stop
	@$(MAKE) --no-print-directory up

reset: ## Fresh seed data: re-runs every migration and supabase/seed.sql
	$(PNPM) db:reset

nuke: ## Stop the stack and throw its data away
	$(SUPABASE) stop --no-backup

status: ## The stack's URLs and keys
	$(SUPABASE) status

# --- Logs ---------------------------------------------------------------------

logs: ## Edge Function logs, one JSON line per request (SINCE=10m, FOLLOW= to not follow)
	docker logs $(FOLLOW) --since $(SINCE) supabase_edge_runtime_$(PROJECT)

logs-errors: ## Only the failed Edge Function requests
	@docker logs $(FOLLOW) --since $(SINCE) supabase_edge_runtime_$(PROJECT) 2>&1 \
		| grep --line-buffered '"level":"error"' || echo "no failed requests in the last $(SINCE)"

logs-db: ## Postgres logs
	docker logs $(FOLLOW) --since $(SINCE) supabase_db_$(PROJECT)

logs-auth: ## Auth logs: sign-in codes, anonymous sessions
	docker logs $(FOLLOW) --since $(SINCE) supabase_auth_$(PROJECT)

logs-api: ## API gateway: every request and its status
	docker logs $(FOLLOW) --since $(SINCE) supabase_kong_$(PROJECT)

# --- The database -------------------------------------------------------------

psql: ## A psql shell on the local database
	psql $(DB_URL)

sql: ## Run one statement: make sql Q="select count(*) from public.circles"
	@test -n "$(Q)" || { echo 'usage: make sql Q="select …"'; exit 1; }
	psql $(DB_URL) -c "$(Q)"

limits: ## Clear the rate limits ("Too many tries" locally)
	psql $(DB_URL) -c "delete from jobs.rate_counters"

mail: ## Latest captured emails; make mail TO=someone@example.com for their sign-in code
	MAILPIT_URL=$(MAIL_URL) $(PNPM) mail $(TO)

studio: ## Open Supabase Studio and Mailpit in the browser
	@if [ "$(SLOT)" = 0 ]; then open http://127.0.0.1:$(STUDIO_PORT); \
	else echo "slot $(SLOT) runs without Studio; opening the mail catcher only"; fi
	open $(MAIL_URL)

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
	MAILPIT_URL=$(MAIL_URL) $(PNPM) check

test: test-unit ## Unit tests (no stack needed)

test-unit: ## Vitest across packages, app and functions
	$(PNPM) test:unit

test-db: up ## Reset the database, then pgTAP
	$(PNPM) db:test

test-live: up ## The live e2e suite in three user agents; make test-live G="part of a name"
	MAILPIT_URL=$(MAIL_URL) $(PNPM) test:e2e:live $(if $(G),-g "$(G)",)

test-smoke: ## The fixture-mode e2e suite (no stack)
	$(PNPM) test:e2e:smoke

lint: ## ESLint
	$(PNPM) lint

typecheck: ## Every tsconfig, the app's included
	$(PNPM) typecheck

format: ## Prettier, writing
	$(PNPM) format
