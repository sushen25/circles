---
name: review-ticket
description: Adversarially review a ticket's branch or PR in the Circles repo - the standards to judge against, the repo's own traps, how to verify a finding instead of reasoning about it, the severity scale and the report format. Invoked by the reviewing agent so the brief does not have to be retyped; also holds the loop rules for whoever spawned it. Use when reviewing a PR or branch, when asked to review a ticket's work, or when spawning a review agent.
---

You are reviewing somebody else's work, adversarially, on the Circles
repository at `/Users/sushensatturu/Repos/circles`. **Report findings. Change
nothing.** Do not modify, stage, commit or push any file, and leave the working
tree clean — if something you ran wrote a file, `git checkout --` it and say so.

## What to judge against

Read **`AGENTS.md`** first, every time. It is short and it is the contract: the
commands, the package boundaries, ten numbered non-negotiables, a list of
privacy invariants that are meant to be structural rather than remembered, and
the definition of done. Most real findings in this repo are a line in that file
that the diff quietly stops being true.

Then, as the change touches them:

- `docs/mvp-product-spec.md` — the product authority. Product rules live here
  and change only through an ADR (non-negotiable 1), so "the code does X, the
  spec says Y" is a finding even when X is nicer.
- `docs/technical-architecture.md` — §6.3 domain events, §6.4 where each kind of
  rule lives, §8.2 the table-by-table data model, §8.4 the RLS strategy, §9.1
  the function surface, §16 testing.
- `docs/decisions/` — the ADRs. A change that contradicts one needs a new ADR,
  not a comment.

## Get the diff

These branches are often **stacked**, so the base is frequently another branch
rather than `main`. Ask for it, or read it:

```bash
gh pr view <n> --json baseRefName -q .baseRefName
git diff <base>...HEAD
```

A stacked PR's diff against the wrong base shows the whole stack and wastes the
round. Say which base you used.

## Verify, do not reason

A finding backed by a transcript is worth ten backed by reading, and this repo
has a history of confident findings that dissolved on contact — and of
refutations that were wrong because they tested the easy case. If you cannot
reproduce something, say so and say how confident you are.

A local Supabase stack is usually running with the branch applied:

```bash
cd /Users/sushensatturu/Repos/circles
corepack pnpm exec supabase status -o env | grep '^DB_URL' | cut -d'"' -f2
```

`psql` is on the PATH. Read-only queries and `begin … rollback` transactions are
free; use them freely. `corepack pnpm exec supabase db reset` and
`supabase test db` are available, as are `check:functions`, `check:events`,
`check:transitions`, `gen:functions` and `db:test`.

**Things that will bite you in a reproduction**, all of them learned the hard
way in this repo:

- **Short codes** must match `^[a-hjkmnp-z2-9]{6,12}$` — no `i`, `l`, `o`, `0`
  or `1`. `pnproof` is rejected; `pnprufx` is fine. This has cost three
  reproductions.
- **Plan fixtures live in 2099.** Deadline and last-possible-start triggers
  refuse a window in the past, and a 2026 fixture expires.
- **`row IS NOT NULL` on a composite is true only when every field is** — so
  `select create_circle(...) is not null` is `f` for a perfectly good circle.
  Test `id is not null` instead.
- **Temporary tables need `grant select … to authenticated`** before a test
  acting as a member can read them.
- **A null CHECK result passes.** `(a and b) or (c and d)` with a null is not a
  refusal; the repo uses `case` or `coalesce(…, false)` for this and a new
  constraint that forgets is a finding.
- **RLS on `UPDATE`**: Postgres applies `SELECT` policies only when the
  statement has to read columns. An `update … where` and an unqualified
  `update` are *different attack surfaces* — test both, or a refutation is
  half a refutation.
- **Superuser**: the `postgres` role is not one. `supabase_admin` is, on the
  same credentials — swap the user in `DB_URL`.
- **Read the exit code, never the tail.** `cmd | tail` reports `tail`'s status.
  A command's last line looking fine is not the command passing.

## Severity

- **P0** — broken or insecure as it stands.
- **P1** — a real defect that must be fixed.
- **P2** — should be fixed, not urgent.

Judge by what actually happens, not by how alarming it sounds. "A removed member
*could* write if somebody later added `security definer`" is a real finding about
a guard that holds by accident, but it is not a live hole, and saying which it is
matters more than the label.

## Report

Findings, most severe first. For each one:

- **Severity**, **location** (`path:line`).
- **What breaks** — concrete inputs or state, and the wrong outcome. Not a
  category of concern. "This is not validated" is not a finding; "with `X`, the
  row lands with `Y` and the dispatcher then sends twice" is.
- **Evidence** — the transcript, or an honest statement that it is reasoned.
- **Scope** — whether it is in code *this change wrote*, or in code the change
  only moved or sits beside. The second kind belongs to a different ticket and
  the distinction decides who fixes it.

End with a short list of **what you tried to break and could not** — it tells
the author which claims are now load-bearing. If you find nothing of substance,
say that plainly instead of padding.

Two things are more useful than a clean bill, so say them when they are true:
that a fix is more machinery than the problem deserves, and that a failure
message would not help the person who hits it.

## Two shapes account for most findings here

- **A guard that checks the form it anticipated rather than the property it
  claims** — a non-empty candidate id instead of a real one, a band's length
  instead of its position in time, an epoch boundary instead of one on
  somebody's clock, `create or replace function` in lower case instead of "a
  function is being defined".
- **A constant or comment standing in for enforcement** — a doc comment
  promising a check "fails loudly" when nothing calls it; a migration header
  asserting that the test suites prove something nobody measured.

And one specific to this repo: **a rule written twice disagrees with itself.**
The state machine, the event catalogue and the forbidden-key list are generated
from TypeScript for that reason (`scripts/gen-*.mjs`, each with a `--check` in
the gate). A diff that adds a second copy of a rule is a finding even when both
copies are currently correct.

## For whoever spawned this review

The loop, from `implement-linear-ticket`:

- **Every P0 and P1 is fixed, always** — or shown to be wrong, with the
  reproduction that shows it.
- **Review again after every round that found a P0 or P1**, until a round comes
  back with neither. The stopping condition is a clean round, not a round count.
- **P2s stop being fixed after round three** and are written up on the PR
  instead — unless they are a line of `AGENTS.md`, which is not optional.
- **Push after every round**, and check `gh pr view <n> --json headRefOid`
  against `git rev-parse HEAD` before calling a PR ready.
- **Write the test that would have caught it**, and check it fails against the
  previous behaviour. A test that passes either way is not a test.
- **Findings in code this change only moved** go on the ticket that owns that
  code, named and evidenced, not fixed here.

Spawn the reviewer with the `Agent` tool, `model: 'fable'`, and a prompt that
says which PR and base, what the change is trying to do, which claims to attack
hardest, and **to invoke this skill for the standards and the report format** —
the brief does not need repeating. Run it in the foreground: the next action
depends on the result.
