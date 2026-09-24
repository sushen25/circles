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
free; use them freely — but note that **`psql -Atc "a; b; c"` prints only the
last result**. Feed a multi-step probe on stdin or with `-f`, and open it with
`\set ON_ERROR_ROLLBACK on` when some steps are *expected* to error, or the
first one aborts the rest. `corepack pnpm exec supabase db reset` and
`supabase test db` are available, as are `check:functions`, `check:events`,
`check:transitions`, `gen:functions` and `db:test`. The suites roll back what
they do, so `supabase test db` and `node scripts/check-function-coverage.mjs`
can be run **without** a reset — a minute you do not need to spend. Reset only
after a migration changes, and remember that `supabase test db` alone does *not*
re-apply migrations, so a function you just regenerated is not in the database
until you do.

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
- **RLS on `INSERT`**: a `BEFORE ROW` trigger runs *before* the policy's
  `WITH CHECK`. So a write that dies in a trigger proves nothing about the
  policy, and a deny test asserting `42501` may be passing for the wrong
  reason. To test the policy alone, give the trigger the privileges it lacks
  for the length of the assertion — `alter function … security definer` inside
  the rolled-back transaction — and see what answers then.
- **Superuser**: the `postgres` role is not one. `supabase_admin` is, on the
  same credentials — swap the user in `DB_URL`.
- **Read the exit code, never the tail.** `cmd | tail` reports `tail`'s status.
  A command's last line looking fine is not the command passing.
- **macOS has no `timeout` or `setsid`**, and a foreground `sleep` is blocked.
  `perl -e 'setpgrp(0,0); exec @ARGV' <cmd>` gives a process group you can
  signal, and `perl -e 'select(undef,undef,undef,2)'` waits two seconds — which
  is how you test what an interrupted run leaves behind.

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

## Reviewing a generator or a check script

Several of the gate's rules are plain functions over strings — `analyse`,
`render` and `selfTest` in `scripts/sql-functions-rules.mjs`, for instance — and
they are exported. **Import them into a scratch file and feed them a tree that
does not exist.** It is faster than editing migrations to see what fires, it
cannot dirty the repository, and it is how the sharpest finding of the skill's
first outing was made: that the rule was never shown the one file a developer
edits. Put the scratch file in the session scratchpad, not the repo.

## When you are asked to confirm a previous round

The findings are on the PR: `gh pr view <n> --comments`. Confirm each one
yourself rather than taking the author's word — a fix that closes the reported
symptom and leaves the cause is the common failure — and then look again with
fresh eyes, because the fixes are new code and new code is where the next
finding usually is.

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

## The loop, for whoever runs the review

This section is read by the author's session, not by the reviewer. It is the
one copy of the review loop: `implement-linear-ticket` and
`work-tickets-in-parallel` point here rather than repeating it, so the rules
cannot drift apart. Read it before the first round.

### Who does the reviewing

**Codex first.** From the ticket's branch, using the Codex CLI (there is no
slash command for it):

```bash
codex review --base <the PR's base>
```

The base is the PR's base, which for a stacked PR is the **previous ticket's
branch**, not `main` — a review against the wrong base reads the whole stack and
wastes the round. **Always run it in the foreground and wait**; never background
it, and never ask which to do.

**Then tell a clean round from a broken one, because they look alike and mean
opposite things.**

- *Codex reviewed the branch and found nothing* — a clean round. It ends the
  loop.
- *Codex did not review the branch* — "Reviewer failed to output a response",
  "Turn failed", or a usage-limit line naming a time it will be back. **This is
  not a clean round.** Nothing has been reviewed, and stopping here would hand
  over work nobody looked at. It has happened twice.

**On a broken round, fall back to the agent** rather than waiting for limits to
reset — unless the founder says to wait. This is the expected path for the
later rounds, not an exception: SUS-42 and SUS-45 both ran seven rounds and
Codex hit its usage limit at round five on each. Spawn the agent with the
`Agent` tool and `model: 'fable'`, in the foreground, and tell it:

- the PR number, the branch, and the base;
- what the change is trying to do, and which of its claims to attack hardest;
- to invoke **`review-ticket`** for the standards, the traps and the report
  format — do not retype the brief;
- where the previous rounds' findings are, when you are asking it to confirm
  them.

Run it in the foreground: the next action depends on the result.

The two reviewers are not interchangeable, which is the other reason to keep the
fallback: Codex reads the diff, while the agent can reach the running database
and reproduce a claim. Findings from either are worked the same way, and a round
by either counts as a round.

`/code-review` is the built-in third option if both are unavailable.

### Working the findings

What follows holds whoever produced them.

**Every P0 and P1 is fixed, always.** There is no round budget for those and no
judgement call about them: if the reviewer marks a finding P0 or P1, either the
code changes or the finding is shown to be wrong, with the reproduction that
shows it. S1-05's P1 was a token interpolated into an exception message, which
means a token in a log — the kind of thing that is cheap now and unfixable
later.

**The stopping condition is a clean round, not a round count.** Ask for
another round after each fix, because findings surface in layers: S1-02 took two
rounds and S1-03 five, and two of S1-03's findings were only reachable once an
earlier fix had changed the shape of the code. S1-08's third round found two
P1s — and the review stopped there, because "three rounds" had been read as the
end. It is not. The rule, stated so it cannot be misread:

- **Review again after every round that found a P0 or P1**, however many rounds
  that takes. The review ends only when a round comes back with **no P0 and no
  P1**. A fix is not verified by making it; it is verified by the next round
  not finding it — and the next round is also the only thing that finds what
  the fix broke.
- **P2s stop being *fixed* after the third round**, because the returns fall
  off and a fourth round on a P2 that is really a preference costs more
  attention than it buys — **unless the P2 is a line of `AGENTS.md`**, which is
  not optional at any round. They do not stop being *reviewed*: a P2 in round
  four is written up in the PR comment — what was found, why it was not done
  now, whether it belongs on a later ticket — rather than fixed. Ending on
  unaddressed P2s is a decision to state out loud, not a thing to do quietly.

So a ticket whose round three fixes a P1 gets a round four. If round four is
P2-only, write those up and stop; if it finds a P1, fix it and run round five.

**Push every round before the founder merges.** A fix that is committed locally
and not pushed is a fix that is not in the PR: S1-05 was merged at its first
commit while four rounds of review fixes — the P1 included — sat on the branch
behind it, and they needed a second PR to land. `git push` after each round, and
check `gh pr view <n> --json headRefOid` against `git rev-parse HEAD` before
saying a PR is ready.

**Verify before you fix.** Reproduce the finding against the built package —
`pnpm run build` then a `node -e` import of `packages/domain/dist/…` — and keep
the output. Then fix, and run the same reproduction again. On S1-03 a finding
was twice real while the reported cause was not the whole cause, and once the
obvious fix would have broken a different invariant.

**Say so when a citation is weak, and separately whether the finding stands.**
One review cited an AGENTS.md line about storing instants as requiring
zone-local rounding. The line does not say that; the finding was right anyway
for a better reason found in the code. Both halves are worth saying.

**Write the test that would have caught it**, and check it fails against the
previous behaviour. More than once the existing test passed on the broken code
because it asserted the wrong property — cell *duration* when the bug was in
the cell's *label*, or an epoch alignment when the painter produced local
alignment. If a test would have passed before the fix, it is not the test.

**`vitest run` does not typecheck tests.** `pnpm --filter … exec vitest run`
passing means less than it looks; a changed return type broke four call sites
that only `pnpm check` found. Report the gate, not the filtered run.

**A finding about a product rule is an ADR, not a code change.** Non-negotiable
1: product rules live in the spec and change only through an ADR. If the review
says "the spec says X and the code does Y", either conform or write the ADR and
update the spec — a decision recorded in a Linear ticket is not the spec, and a
client built against the spec will disagree with the code.

**Findings in code this change only moved** go on the ticket that owns that
code, named and evidenced, not fixed here.

**Fixing an exported shape invalidates the notes you left.** When a fix changes
a signature, an error shape or a documented behaviour, go back to the downstream
tickets that `implement-linear-ticket` step 11 wrote to and correct them. Three
notes on SUS-31, SUS-42 and SUS-49 told later tickets to use a
`TransitionError.message` that review then removed.

**Then reply on the PR** with what was found, what changed, what you pushed back
on, any P2 left open at round three and why, and the reproduction output. If a
fix changed anything the testing notes describe — a screen's text, a step, an
expected result — correct the notes on the PR and on Linear in the same pass
(`implement-linear-ticket` step 9).
`gh pr comment <n> --body "$(cat <<'BODY' … )"`.

The two shapes above account for most findings here and are worth looking for
before the reviewer does.
