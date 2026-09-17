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
| `pnpm test:e2e:live` | yes | Exports the web app pointed at the local stack and walks the guest journeys in three user agents. |

Run one file or one test with `pnpm exec vitest run <path>`, or
`pnpm test:e2e:live -g "<part of a test name>"`. But `vitest run` does not
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
  restarting that one container is not enough. The log is
  `docker logs supabase_edge_runtime_circles`.
- **A screen shows Sunday Crew but nothing reaches the database.** You are in
  fixture mode. Check `apps/app/.env.local` exists, is in `apps/app/`, and that
  the dev server printed `env: load .env.local`. Restart it after creating it.
- **A build still talks to the backend, or doesn't, after you changed
  `.env.local`.** Metro caches the inlined `EXPO_PUBLIC_*` values. Restart with
  `pnpm dev:web --clear`.
- **"Too many tries" or `too_many_requests`.** The rate limits count per
  address, and locally every request comes from the same one. Clear them with
  `delete from jobs.rate_counters;`.
- **"This link has expired" on a re-entry link you just made.** It is single
  use. Mint another.
- **`db:start` says a port is in use.** Another Supabase project is running.
  Stop it with `supabase stop --project-id <its id>`, or stop Docker containers
  with `supabase_` in the name.
- **`pnpm: command not found`.** Run `corepack enable`.
