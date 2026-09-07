# AGENTS.md

Authoritative for anyone working in this repository, human or agent. Short on
purpose — read it every time.

## What this is

**Circles** (codename; nothing may assume the final name) helps a small group
that keeps saying "we should catch up" actually meet. A member shares one link
into their group chat; friends mark the times they would genuinely be up for,
with no account and no app; the organiser confirms a real time.

|              |                                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------- |
| Product      | [`docs/mvp-product-spec.md`](docs/mvp-product-spec.md)                                                              |
| Architecture | [`docs/technical-architecture.md`](docs/technical-architecture.md)                                                  |
| Design       | [`docs/design-manifesto.md`](docs/design-manifesto.md), canvas source in [`docs/design/gen.py`](docs/design/gen.py) |
| Decisions    | [`docs/decisions/`](docs/decisions/README.md)                                                                       |
| Guest → app  | [`docs/guest-to-app-flow.md`](docs/guest-to-app-flow.md)                                                            |
| How we work  | [`docs/working-process.md`](docs/working-process.md), tickets in [`docs/tickets.md`](docs/tickets.md)               |

## Commands

Node 22 (`.nvmrc`), pnpm 9 via Corepack, Docker running.

```bash
pnpm i                 # install
pnpm db:start          # local Supabase (Docker)
pnpm dev               # Expo dev server; w / i / a to open a platform
pnpm dev:ios           # native development build (see apps/app/README.md first)
pnpm dev:android       # native development build
pnpm check             # the gate: everything CI runs
pnpm db:test           # reset the database and run pgTAP
pnpm gen:types         # regenerate database types from the local schema
pnpm gen:tokens        # regenerate design tokens from docs/design/gen.py
pnpm test:e2e          # Playwright against the exported web build
```

`pnpm check` is the whole gate and CI runs exactly it. If it passes locally it
passes in CI, and vice versa.

## Boundaries

The dependency rule (architecture §7.2), enforced by `eslint-plugin-boundaries`:

- `packages/domain` imports **nothing** but the standard library and
  `date-fns-tz` — and that only inside `shared/zone.ts`. No React, no Supabase,
  no Deno, no I/O.
- `packages/contracts` imports `domain`, and adds Zod schemas and generated
  database types.
- `apps/app` and `supabase/functions` import both. They never import each other.
- Inside `apps/app`: routes → `features` → `components`/`data`/`platform`/`copy`/
  `analytics`. **`data` and `platform` never import `features`.**
- `packages/tokens` and `packages/config` depend on nothing.

Where each kind of rule lives (§6.4):

| Rule                    | Lives in                                                      |
| ----------------------- | ------------------------------------------------------------- |
| Pure calculation        | `packages/domain`                                             |
| Transition guard        | `packages/domain` **and** a Postgres function (authoritative) |
| Invariant on data shape | Postgres constraints                                          |
| Authorisation           | RLS policies and `security definer` functions                 |
| Orchestration           | Edge Functions                                                |
| Presentation            | `apps/app`                                                    |

## Non-negotiables

From architecture §7.6:

1. Product rules live in the spec; architecture rules live in the architecture.
   Both change only through an ADR.
2. Never put a decision in a screen. If a screen needs to know whether something
   is allowed, the answer comes from `packages/domain`.
3. Never write a table type by hand; run `pnpm gen:types`.
4. Never change schema in the dashboard; write a migration and a pgTAP test in
   the same PR.
5. Every RLS policy ships with a test proving both the allow and the deny.
6. Every user-facing string is a key in `src/copy`; no literals in components.
7. Every analytics event is declared in the catalogue first.
8. No sensitive data — names, emails, tokens, event titles, notes — in logs or
   analytics payloads.
9. `pnpm check` must pass; CI runs the same command.
10. Keep files under ~300 lines; split by responsibility.
11. Prefer a small pure function to a dependency.

## Privacy invariants

From spec §8.2. These are structural, not procedural — the code and the database
make them impossible, not someone remembering:

- Every plan belongs to one circle; only active members see or act on it.
- Organiser roles belong to saved-place identities only. A quiet plan has no
  organiser until a member explicitly accepts.
- A revision has at most one active confirmation; a confirmed time never changes
  as a side effect of a later response.
- **Raw device-calendar events never enter the backend.**
- Availability is scoped to one plan revision and never silently reused.
- **Quiet-ask initiator identity and individual interest answers are never
  exposed**, before or after threshold.
- A reattachment moves a membership only within a circle the guest already
  belongs to, never onto a saved-place member.
- Plan-update email consent is scoped to one plan and is never marketing consent.
- **No client, log or analytics context ever holds a raw email address, token,
  note or event title.**
- Times are stored as instants with an IANA zone; transitions are server-side
  and idempotent.

## Definition of done

A feature is done when (spec §16):

acceptance criteria pass · all eight screen states exist (default, empty,
partial, loading, error, offline, permission denied, expired/cancelled) ·
the analytics event is emitted and schema-tested · an RLS or database test
exists · copy lives in the copy files, with no exclamation marks on working
screens · no sensitive data in logs or analytics · the seed scenario and the
canvas mapping are updated · an ADR is written if a rule changed.

## Changing a rule

Write an ADR in [`docs/decisions/`](docs/decisions/README.md), numbered
sequentially, following the shape of the existing ones: Context, Decision,
Alternatives considered, Consequences. A superseded record stays in place with a
status line. Then change the spec or the architecture in the same PR.

## The scenario

Every fixture, test and piece of placeholder copy uses the same one, so they
cannot quietly disagree:

**Sunday Crew** — six members. **Maya** owns it. Priya, Tom, Jess and Sam have
answered; **Alex has not**, which is the point: the partial state is the most
common real one. The plan is **Thursday 17 September, 6:30–8:30 pm, at Hope St
Radio**, in `Australia/Melbourne`. Availability runs 5:30–10:30 pm in ten
half-hour cells.

It lives in `apps/app/src/data/fixtures/` and
`packages/domain/src/shared/fixtures.ts`. Add to those rather than inventing a
second cast.
