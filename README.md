# Circles

Codename only — nothing in code, domains or store metadata should assume the
final name (architecture §5.4).

A pnpm monorepo: a pure `packages/domain` shared verbatim by the Expo app and
the Supabase Edge Functions ([ADR 0007](docs/decisions/0007-pnpm-monorepo-with-shared-domain-package.md)).

## Setup

Node 22 (see `.nvmrc`) and pnpm 9 via Corepack:

```bash
corepack enable
pnpm i
pnpm check
```

`pnpm check` is the single gate; CI runs exactly this command (architecture §16).

## Commands

| Command           | What                                                               |
| ----------------- | ------------------------------------------------------------------ |
| `pnpm check`      | format, lint, typecheck, unit tests, database tests, web e2e smoke |
| `pnpm format`     | Prettier write                                                     |
| `pnpm lint`       | ESLint, including the architecture boundaries                      |
| `pnpm typecheck`  | `tsc -b` across the packages, then the test sources                |
| `pnpm build`      | build every package to ESM (`packages/*/dist`)                     |
| `pnpm test:unit`  | Vitest across the workspace                                        |
| `pnpm gen:types`  | generated Supabase types (S0-06)                                   |
| `pnpm gen:tokens` | design tokens from `docs/design/gen.py` (S0-03)                    |

`db:test`, `test:e2e:smoke`, `gen:types` and `gen:tokens` are placeholders that
print the ticket that implements them and exit 0. The shape of the pipeline is
fixed now so no later ticket has to change what `check` means.

## Layout

```text
apps/app/          the Expo universal app                       (S0-02)
packages/domain    pure TypeScript rules — no React, no I/O
packages/contracts Zod schemas, generated DB types, analytics    (S0-05)
packages/tokens    design tokens and fonts                       (S0-03)
packages/config    brand, feature flags, environment schema
supabase/          migrations, functions, database tests         (S0-06)
docs/              spec, architecture, ADRs, design canvas
```

The dependency rule (architecture §7.2) is enforced by `eslint-plugin-boundaries`:
`domain` imports nothing; `contracts` imports `domain`; the app and the functions
import both and never each other; inside the app, `data` and `platform` never
import `features`.

## Working a ticket

See [`docs/tickets.md`](docs/tickets.md). Branch from `main` with Linear's branch
name, keep the PR to the ticket's scope, `pnpm check` green, then move the ticket
to In Review with the PR link.
