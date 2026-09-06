# ADR 0007: One pnpm monorepo with a pure `packages/domain` shared by the client and Edge Functions

_Status: accepted · Date: 6 September 2026_

## Context
The candidate engine, plan state machine, deadline defaults, eligibility rules and share messages must behave identically on the client (for immediate feedback) and on the server (as the authority). Two copies would drift. A separate Node API service would carry operational cost for a validation MVP.

## Decision
A pnpm workspace with `apps/app` (Expo), `packages/domain` (pure TypeScript, no I/O), `packages/contracts` (Zod schemas, generated DB types, analytics catalogue), `packages/tokens`, `packages/config`, and `supabase/` (migrations, functions, tests). `packages/domain` is imported by both `apps/app` and `supabase/functions`. Dependency direction is enforced with `eslint-plugin-boundaries`. Edge Functions import the domain package through an import map pointing at the built package.

## Alternatives considered
- **Separate repos or copies per runtime** — drift.
- **Custom Node API + managed Postgres** — maximal control, but deployment, auth, worker and ops decisions before they are useful.

## Consequences
- The domain package must stay free of React, Supabase and Deno-specific APIs.
- `pnpm check` runs every layer; CI mirrors it exactly.
- Edge Function bundling must be verified to tree-shake the domain package correctly (ticket in Slice 0).
