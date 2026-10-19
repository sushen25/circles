---
adr: 75
title: "Edge Function dependencies are exact and locked"
status: accepted
date: 2026-10-15
amends: [7]
---
# ADR 0075: Edge Function dependencies are exact and locked

_Status: accepted · Date: 15 October 2026 · amends [ADR 0007](./0007-pnpm-monorepo-with-shared-domain-package.md)_

## Context

[ADR 0007](./0007-pnpm-monorepo-with-shared-domain-package.md) gave the Edge Functions the shared packages through an import map. Deno has no `node_modules`, so every `npm:` entry in that map is resolved by the bundler on the day of `supabase functions deploy`. Three entries were caret ranges and there was no lock file, so what reached production was the newest release inside the range that day, and the newest transitive dependency of every package, not what `pnpm-lock.yaml` and the test suites had run against. A bad release of `@supabase/supabase-js` would have shipped, unreviewed, into code that holds the service role.

## Decision

- Every `npm:` entry in `supabase/functions/import_map.json` is an exact version, and it is a version `pnpm-lock.yaml` resolves for the same package.
- `supabase/functions/deno.lock` is committed, and every function's `deno.json` points at it with `"lock": { "path": "../deno.lock", "frozen": true }`. The local stack, a deploy bundle and Deno itself all read that one config, so there is no second place to forget.
- `pnpm check:imports`, inside `pnpm check` and run again before each deploy workflow's `functions deploy`, fails on a range, on a version that disagrees with the pnpm lock, on an import-map entry the lock does not name, on a package whose hash differs between the two locks, and on a function whose `deno.json` does not use the lock.
- `hello`, the smoke-test function ADR 0007 asked for, is deleted. It was deployed unauthenticated and its own header said to delete it once a real function covered the ground. The deploy smoke check is an empty POST to `track-events`.

## Alternatives considered

- **A `--frozen` flag on the deploy command.** The pinned Supabase CLI has none: it never reads `deno.lock`. What honours the lock is the edge runtime's bundler, through the function's `deno.json`.
- **Lock only, ranges left in the map.** The lock would pin them, but the first regeneration would move them silently, and the map would still say something the deploy does not do.
- **Run `deno cache --frozen` in CI.** It would catch an incomplete lock, which the bundler does not. It also means installing a Deno binary in every workflow. Left as a follow-up; see Consequences.

## Consequences

- Bumping a dependency is three deliberate edits: the pnpm lock, the import map, and `deno.lock`, regenerated as `supabase/functions/README.md` describes. `check:imports` names whichever is missing.
- The edge runtime verifies the hash of every package the lock lists and refuses a mismatch. It does **not** refuse a package the lock omits, and it never writes the lock. A transitive dependency missing from the lock is therefore resolved at deploy time. The check can see a missing import-map entry but not a missing transitive one, so regenerate the lock with Deno and commit the whole file.
- `@react-email/render` has a peer dependency on `react-dom` that no import-map entry can pin, because Deno resolves a peer from the package graph and ignores an unused map entry. The lock holds the version Deno chose (a `react-dom` newer than the one pnpm tests with). It is frozen, not aligned; replacing the `@react-email/*` packages is the way out.
