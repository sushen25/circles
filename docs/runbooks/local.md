# Local development

From a clean clone to the app running against a local database, signed in,
joining a circle. Every step here was walked on a clean stack (17 September
2026) before it was written down. If one no longer works, fix this file in the
same PR as whatever changed it.

`local` is one of three environments; how it differs from `dev` and `prod` is in
[`environments.md`](./environments.md). The rules for working in the repository
are in [`AGENTS.md`](../../AGENTS.md).

## What you need

- **Node 22** (`.nvmrc`). Node 24 also works; CI uses 22.
- **pnpm 9 through Corepack.** Run `corepack enable` once, and `pnpm` then
  resolves to the version in `package.json`. Don't install pnpm globally.
- **Docker**, running. The whole backend is containers.
- **`psql`**, for the SQL snippets below and for the live e2e suite.

## The short version: `make`

A `Makefile` at the root wraps the commands below, so the common things are one
word. `make` on its own lists every target. Each one runs a `pnpm` script or a
command from this page, which stays the explanation of what it does.

```bash
make setup    # first run: Corepack, dependencies, packages built, stack up, app env written
make dev      # stack up, env written, packages built, web app on http://localhost:8081
```

| You want | Run |
|---|---|
| **The app, against the local stack, with live reload** | `make dev` (http://localhost:8081) |
| The same build the live e2e suite serves (exported, no Metro) | `make dev-live` (http://localhost:8082) |
| **Stop everything**: the app servers on 8081, 8082 and 8083, then the stack (data kept) | `make dev-down` |
| Start, stop, restart the stack | `make up`, `make down`, `make restart` |
| Fresh seed data | `make reset` |
| Throw the stack's data away | `make nuke` |
| The stack's URLs and keys | `make status` |
| Rewrite `apps/app/.env.local` from the running stack | `make env` |
| **Edge Function logs**, following | `make logs` (one JSON line per request) |
| Only the failed requests | `make logs-errors` |
| Postgres, auth, API gateway logs | `make logs-db`, `make logs-auth`, `make logs-api` |
| A psql shell | `make psql` |
| One statement | `make sql Q="select count(*) from public.circles"` |
| Clear the rate limits ("Too many tries") | `make limits` |
| Captured emails; a sign-in code | `make mail`, `make mail TO=someone@example.com` |
| Studio and Mailpit in the browser | `make studio` |
| Regenerate SQL functions and database types | `make gen` (resets the database), or `make types` alone |
| Everything CI runs | `make check` |
| Tests | `make test-unit`, `make test-db`, `make test-live G="part of a name"`, `make test-smoke` |
| Which project and ports this checkout uses | `make ports` |
| Every local environment running, whoever started it | `make envs` |

The log targets look back ten minutes and keep following. `SINCE=` changes how
far back, and `FOLLOW=` prints and exits: `make logs SINCE=1h FOLLOW=`. When a
screen shows **"Ref XXXX"**, that's the request's reference, and
`make logs FOLLOW= SINCE=1h | grep -i XXXX` finds its line. Function logs never
carry a token, an address or a name (non-negotiable 8).

`make dev` and `make dev-live` are the same app against the same stack.
`dev` is Metro with live reload, for writing code. `dev-live` is the exported
build the live e2e suite serves, for checking a PR's testing notes; it does not
pick up edits until it is run again. Stop `dev-live` (or `make dev-down`)
before `make check` or `make test-live`: the suite reuses a server already on
8082, whatever build it is serving. `dev-down` stops only `node` processes
listening on those ports, so anything else of yours on them is left alone.

### One build directory, and what stops you serving the wrong one

`make dev-live`, the live e2e suite and the smoke suite all export into
`apps/app/dist`, and the smoke suite exports with the Supabase variables
deliberately blank — a fixture journey that could reach a backend is not a
fixture journey. `expo serve` needs a real project root, so the three cannot
have separate directories without a second copy of the app; whichever exported
last owns it.

That used to be silent, and it cost two afternoons: a plan link that let anybody
straight into the availability editor without asking for a name (the fixture
build, so no membership gate), and a check whose ninety live tests all failed
against a dev server Playwright had reused.

Each export now stamps `dist/client/build-mode.json`, and two things read it:

- **`make dev-live` stops** when something else exports over its build, saying
  so. A server that has exited is one you can see has exited; a server quietly
  handing you the fixture app is not. Start it again once the check is done.
- **Each suite refuses** a server serving the other's build, before its first
  test, naming what is actually there.

So: don't run `make check` and `make dev-live` at once — and if you do, nothing
lies to you about which app you are looking at.

### The ports follow the checkout

Every port above is the default because this checkout's `supabase/config.toml`
says `project_id = "circles"`. A ticket worktree made by the
work-tickets-in-parallel skill renames the project `circles-s<N>` and shifts
every port by 100 x N, so a second stack can run beside this one. The Makefile
reads that file, which means the same `make dev`, `make logs`, `make psql` and
`make mail` do the right thing in either place, and `make ports` says which:

```
circles (slot 0) · api 54321 · db 54322 · mail 54324 · app 8081 · live 8082
```

`make envs` lists every stack running on the machine, whichever checkout
started it, with the worktree each one belongs to and any app server that is
listening:

```
circles      slot 0 · api 54321 · db 54322 · mail 54324 · /Users/you/Repos/circles
circles-s2   slot 2 · api 54521 · db 54522 · mail 54524 · /Users/you/Repos/circles-wt/sus-35
app server on :8282
```

So never pass a port by hand, and never edit `config.toml` to change one. Two
things do not move: the Playwright suites serve on 8082 and 8083 whichever
checkout runs them, which is why only one `make check` runs at a time, and a
slot's stack starts without Studio to save memory (`make studio` there opens
only the mail catcher).

`make restart` is the one to reach for after adding an Edge Function folder or
when every function returns `BOOT_ERROR` (see *When it goes wrong*): the functions
container only sees files that existed when the stack started.

The numbered sections below are the long version: what each step does, and why.

## 1. Install and start the backend

```bash
corepack enable
pnpm i
pnpm db:start
```

`db:start` pulls the Supabase images the first time, which takes a few minutes.
After that it takes about thirty seconds: it applies every migration in
`supabase/migrations/`, runs `supabase/seed.sql`, and prints the stack's URLs and
keys as JSON.

| What | Where |
|---|---|
| API (the app talks to this) | `http://127.0.0.1:54321` |
| Postgres | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |
| Studio (a database UI) | `http://127.0.0.1:54323` |
| Mailpit (every email the stack sends) | `http://127.0.0.1:54324` |
| Edge Functions | served by the stack at `http://127.0.0.1:54321/functions/v1/<name>` |

Those URLs and keys are Supabase's published local demo values, the same on
every machine. They are still shaped like credentials, so don't paste them into
a committed file; CI's secret scan will refuse the branch (see AGENTS.md).

To see them again later, while the stack is running:

```bash
node_modules/.bin/supabase status
```

## 2. Point the app at it

**Without this step the web app runs in fixture mode**: every screen renders
placeholder data from `apps/app/src/data/fixtures/` and nothing talks to the
database. That is deliberate. It is how the design gallery and the smoke e2e
suite work, and it is why a route looks fine and then does nothing. The switch
is `hasBackend()` in `apps/app/src/data/auth/client.ts`.

Write `apps/app/.env.local` from the running stack. It is gitignored.

```bash
node_modules/.bin/supabase status -o env \
  | sed -n 's/^API_URL=/EXPO_PUBLIC_SUPABASE_URL=/p; s/^ANON_KEY=/EXPO_PUBLIC_SUPABASE_ANON_KEY=/p' \
  > apps/app/.env.local
echo 'EXPO_PUBLIC_APP_ORIGIN=http://localhost:8081' >> apps/app/.env.local
```

It has to be **`apps/app/.env.local`**, not one at the repository root: Expo
reads env files from the app's own directory. When it is picked up, the dev
server prints `env: load .env.local`.

Leave `EXPO_PUBLIC_TURNSTILE_SITE_KEY` unset. With no site key the client sends
no Turnstile token, and `redeem-invite` skips verification off a hosted project.

## 3. Run the app

```bash
pnpm dev:web      # web, at http://localhost:8081
pnpm dev          # the Expo dev server; press w, i or a
```

- **`/gallery`** lists every screen, with a switch between fixture scenarios.
  It's the quickest way to look at a design.
- **Native** needs a development build first; read
  [`apps/app/README.md`](../../apps/app/README.md) before trying `i` or `a`.

## 4. What the seed gives you

`supabase/seed.sql` writes four circles through the same functions the product
uses, so every trigger has fired and the data is a state the product can
actually reach. The ids are fixed, so URLs survive a reset.

| Circle | Short code | What it is for |
|---|---|---|
| **Sunday Crew** | `sundaycrew` | The canvas's scenario. Maya owns it; Priya, Tom, Jess and Sam have answered plan `pnsundaycr`, which is still open for answers; **Alex is a guest** who has not. |
| Thursday Regulars | `thursdays` | A meetup that happened, with its outcome reported (`pnthursday`). |
| Uni Mates | `unmates` | A quiet ask still gathering interest (`pnunmates`). |
| The Big Table | `bgtabde` | A circle at the member cap, where screens break if they are going to. |

Everyone in the seed except Alex has a saved place. Nobody in it can sign in with
a password, and no seeded circle has an invite link.

## 5. Try the guest flows

Use a **new private window for each person**. A private window is a browser with
nothing in storage, which is exactly a guest who has lost their session.

**Make an invite link** for Sunday Crew:

```bash
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "insert into public.circle_invites (circle_id, secret_hash, created_by) values ('00000000-0000-4000-8000-000000000a01', extensions.digest('try-the-sunday-crew-invite-by-hand', 'sha256'), '00000000-0000-4000-8000-000000000101')"
```

A circle has at most one live link. To make another, revoke the first:
`update public.circle_invites set revoked_at = now() where circle_id = '00000000-0000-4000-8000-000000000a01' and revoked_at is null;`

- **Join:** open `http://localhost:8081/join#try-the-sunday-crew-invite-by-hand`,
  tap *Choose my times*, and give a name nobody in the circle has. You land on
  `/j/pnsundaycr`.
- **Come back with no session:** in another private window, open
  `http://localhost:8081/p/pnsundaycr`. *Which one is you?* lists the circle's
  guests (Alex, plus anyone you joined as) and nobody with a saved place.
- **The emailed re-entry link:** the steps, with the SQL to mint a token, are
  in the testing notes on
  [PR #54](https://github.com/sushen25/circles/pull/54#issuecomment-5707055406).

## 6. Sign in

Nothing local sends a real email. Sign-in codes land in Mailpit, and
`pnpm mail` reads them:

```bash
pnpm mail                          # the latest messages
pnpm mail maya.local@example.com   # the six-digit code sent to that address
```

The sign-in *screens* are fixture screens until S1-22. Until then, get a code
without them:

```bash
curl -s -X POST http://127.0.0.1:54321/auth/v1/otp \
  -H "apikey: $(node_modules/.bin/supabase status -o env | sed -n 's/^ANON_KEY="\(.*\)"/\1/p')" \
  -H 'content-type: application/json' \
  -d '{"email":"maya.local@example.com","create_user":true}'
pnpm mail maya.local@example.com
```

## 7. Tests

| Command | Needs the stack? | What it runs |
|---|---|---|
| `pnpm check` | yes | Everything CI runs, in CI's order. About ten minutes. |
| `pnpm test:unit` | no | Vitest across the packages, the app and the Edge Functions. |
| `pnpm db:test` | yes | **Resets the database**, then pgTAP. |
| `pnpm test:integration` | yes | The app's auth module against real Supabase Auth and Mailpit. |
| `pnpm test:e2e:smoke` | no | Exports the web app **with no backend** and walks the fixture journey. |
| `pnpm test:e2e:live` | yes | Exports the web app pointed at the local stack and walks the journeys in four browsers: mobile Safari and Messenger's iOS browser (WebKit), Chrome and WhatsApp's Android browser (Chromium). Needs `pnpm exec playwright install chromium webkit` once. |

Run one file or one test with `pnpm exec vitest run <path>`, or
`make test-live G="<part of a test name>" P=iphone-safari` (both optional). But `vitest run` does not
typecheck, so the answer before a PR is `pnpm check`.

The two e2e suites export different builds into the same `apps/app/dist` and
serve them on their own ports, **8083** (smoke) and **8082** (live). Neither
uses Metro's 8081, so a `pnpm dev:web` left running doesn't interfere.
Outside CI, Playwright reuses a server already answering on its port, so if a
suite behaves as though it got the other suite's build, look for a stray
`expo serve` on 8082 or 8083.

## Starting again

| You want | Run |
|---|---|
| Fresh seed data, stack kept running | `pnpm db:reset` |
| Stop the stack, keep the data | `pnpm db:stop` |
| Stop it and throw the data away | `pnpm db:stop --no-backup` |
| New migrations from a pull | `pnpm db:reset`: the running database is not migrated automatically |

## When it goes wrong

- **Every Edge Function returns `BOOT_ERROR`** and the log names a module that
  exists. A new file appeared in `packages/*/dist` after the stack started, and
  the functions container cannot see it. Run `pnpm db:stop && pnpm db:start`;
  restarting that one container is not enough (`make restart`). The log is
  `make logs`, which is `docker logs supabase_edge_runtime_circles`.
- **A screen shows Sunday Crew but nothing reaches the database.** You are in
  fixture mode. Check `apps/app/.env.local` exists, is in `apps/app/`, and that
  the dev server printed `env: load .env.local`. Restart it after creating it.
- **A build still talks to the backend, or doesn't, after you changed
  `.env.local`.** Metro caches the inlined `EXPO_PUBLIC_*` values. Restart with
  `pnpm dev:web --clear`.
- **"Too many tries" or `too_many_requests`.** The rate limits count per
  address, and locally every request comes from the same one. Clear them with
  `make limits`, which runs `delete from jobs.rate_counters;`.
- **"This link has expired" on a re-entry link you just made.** It is single
  use. Mint another.
- **`db:start` says a port is in use.** Another Supabase project is running.
  Stop it with `supabase stop --project-id <its id>`, or stop Docker containers
  with `supabase_` in the name.
- **`pnpm: command not found`.** Run `corepack enable`.
