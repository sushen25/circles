# ADR 0015: A database function's definition lives in one file, generated into migrations

_Status: accepted · Date: 11 September 2026_

## Context

At the end of Slice 1's database tickets the migrations were 4,938 lines, about
2,210 of them (45%) inside function bodies, defining 47 functions. Four were
defined more than once, `planning.transition_plan` three times — in `0003`,
`0004` and `0006`. Nothing in the files says which is current; you have to know
the order in which four tickets touched it.

The founder's review named it: *"application logic seems to live in the database
migrations. This seems inaccessible and wrong."*

Two claims are tangled there, and they need separating.

**That the logic is in the database** is deliberate and stays. `supabase-js` has
no multi-statement transactions and clients reach PostgREST directly, so a
guard that is not in the database is a guard the client can route around, and a
write that is not one function is a write that can half-happen — the failure
found on PR #37, where a `meetup_confirmed` event could be published before the
confirmation row existed. Of the 47 functions, three are callable by a client
(`create_circle`, `replace_response`, `report_outcome`); the rest are triggers
enforcing invariants, RLS helpers, and cron. Architecture §6.4 already says
where each kind of rule lives, and this ADR does not change it.

**That the definitions are filed in an append-only history** is the actual
defect, and it is not required by any of the above. A migration records that
something changed. A definition is something a person reads and edits. They are
different jobs, and one file was doing both.

## Decision

`supabase/sql/functions/<schema>/<name>.sql` holds the current definition of
each function: the `create or replace function` statement, its
`comment on function`, and the `revoke`/`grant` statements that say who may
call it — so "what is this, and who can call it?" is answered in one place
rather than in a body halfway down a migration and its grants four hundred
lines below.

`scripts/gen-sql-functions.mjs` renders every file into a generated block in a
migration, and `pnpm check:functions` — in the `pnpm check` chain — fails when:

- a source file does not define exactly one function, or is filed under the
  wrong name;
- a function is not revoked from `PUBLIC`, or leaves `anon` or `authenticated`
  neither revoked nor granted (the rule that needed remembering on every
  database ticket, now mechanical);
- a function is defined in a migration with no file in the tree, so the next
  ticket cannot quietly add one the old way;
- the generated block and the tree disagree.

This is the third generator on the same pattern: `gen-transitions.mjs` renders
the state machine from `packages/domain`, `gen-events.mjs` the event catalogue
and the forbidden-key list. A rule with two copies gets a generator.

Migrations `0001`–`0007` are not edited. They are history, and `0002`/`0003`
have shipped. `0008` re-creates every function from the tree, which is the seam
where the tree takes over; because each statement recreates a function that
already exists in exactly that form, applying it changes nothing.

## Alternatives considered

- **All logic in Edge Functions, tables reachable only by the service role.**
  The coherent version of the founder's objection, and a normal shape for a
  Rails or Node application. It costs roughly forty endpoints instead of three,
  hand-written authorisation on every read, the loss of PostgREST's direct
  reads that every screen uses, and — because the enforcement would no longer
  be underneath the application — no second line of defence when one of those
  endpoints is wrong. Rejected for an MVP with one engineer.
- **Leave the definitions in migrations.** Zero work, and the cost compounds:
  `transition_plan` was already three deep after four tickets, and Slice 1 has
  thirteen more.
- **Derive the tree from the migrations, read-only.** Fixes reading, not
  editing: a change would still be written as a new copy in a new migration,
  and the tree would still be a report rather than the thing you change.
- **Drop the generated migration and let the tree be applied directly.** There
  is no include mechanism in Supabase migrations, and a definition that is not
  in a migration is not applied to a deployed database.

## Consequences

- To change a function you edit its file and run `pnpm gen:functions`; the gate
  refuses the commit if you forget.
- Once `0008` ships, a change means a new migration and moving `MIGRATION` in
  the generator, exactly as the other two generators already require.
- The generated migration is large (about 2,400 lines) and nobody reads it,
  which is the same bargain as the transition table and the event catalogue.
- `pg_get_functiondef` and the ACL of all 47 functions were captured before and
  after the change and are identical, so the refactor is provably behaviour
  preserving; the pgTAP suites passed unchanged.
- The tree makes the shape of the system visible for the first time: 26
  functions in `public`, 14 in `jobs`, 4 in `planning`, 3 in `private`. That
  is a number worth watching, and it is now watchable.
