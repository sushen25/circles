# supabase

The local stack, the migrations, the database tests and the Edge Functions.

## Commands

Docker must be running. `pnpm check` includes `db:test`, so the stack is not
optional once you are past a pure-TypeScript change.

| Command            | What                                                                     |
| ------------------ | ------------------------------------------------------------------------ |
| `pnpm db:start`    | start the local stack (`supabase start`)                                 |
| `pnpm db:stop`     | stop it; volumes survive                                                 |
| `pnpm db:reset`    | recreate the database, apply migrations, run `seed.sql`                  |
| `pnpm db:test`     | reset, then run every pgTAP file in `tests/database`                     |
| `pnpm gen:types`   | regenerate `packages/contracts/src/db.generated.ts` from the live schema |
| `pnpm check:types` | fail if that file is stale                                               |

`supabase status` prints the local URLs and keys. They are the CLI's fixed
development values — not secrets, and not usable anywhere else.

**Running beside another Supabase project.** The ports are the Supabase
defaults, so only one local stack can run at a time. `supabase stop
--project-id <other>` frees them; volumes are kept.

## Schemas

Architecture §8.1 divides the database by who may reach it:

| Schema      | Exposed via the Data API | Holds                                                   |
| ----------- | ------------------------ | ------------------------------------------------------- |
| `public`    | yes, through RLS         | everything a client may read                            |
| `private`   | **no**                   | email contacts, tokens, quiet-ask interest, push tokens |
| `analytics` | **no**                   | insert-only events and the founder's views              |
| `jobs`      | **no**                   | outbox, notification jobs, cron leases                  |

"Not exposed" is enforced in three places, because one would be a single point
of failure: `config.toml` lists `public` only, `0001_schemas.sql` revokes all
privileges (including default privileges for tables not yet created), and
`tests/database/000_smoke.sql` fails the build if either slips.

## Changing the schema

Never in the dashboard, never by hand on a running database. Write a migration
and a pgTAP test in the same PR (architecture §7.6), then `pnpm db:test`.

Every RLS policy is written against `public.auth_is_member(circle_id)`. It
currently returns `false` — `circle_members` arrives in S1-07 — which is the
safe direction to be wrong in: a policy using it denies rather than grants.

## Edge Functions

Functions import the shared packages through **`functions/import_map.json`**,
referenced by each function's `deno.json`:

```json
{ "importMap": "../import_map.json" }
```

One map, so twenty-two functions do not each repeat the paths. Note that the
map has to be reached this way: pointing `config.toml`'s `[functions.<name>]
import_map` at it, or relying on the CLI's fallback, mounts the files but does
not hand the map to the runtime, and every bare specifier fails to resolve.

**The functions import built output**, so `pnpm build` must have run before
`supabase functions serve`. That is what makes ADR 0007 real: the same
`packages/domain` runs on the client and in Deno, and cannot drift.

`hello` exists only to prove that path works end to end — it imports the domain
package and executes a zod schema from `@circles/contracts` inside Deno. Delete
it when a real function covers the same ground.

```bash
pnpm build && pnpm exec supabase functions serve --no-verify-jwt
curl -X POST http://127.0.0.1:54321/functions/v1/hello
# {"domain":"@circles/domain","contracts":"@circles/contracts","validated":true,"version":1}
```
