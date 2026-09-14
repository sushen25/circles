# ADR 0018: The recalculation runs in the request that caused it

_Status: accepted · Date: 14 September 2026_

## Context

Architecture §9.1 described `submit-availability` as "validates windows,
replaces the member's response for the current revision, bumps `input_version`,
**schedules recalculation**", and put the `collecting ↔ ready` transitions under
`recalculate-candidates`. Read literally, an answer writes a row and something
else, later, works out what it means.

Later is up to a minute: scheduled work is discovered from data by the
dispatcher, which `pg_cron` runs every minute (§9.3). So the person who has just
finished painting their availability — the last of six — would see "thanks" and
an empty screen, and the organiser would be told options were ready somewhere
between one and sixty seconds after they were. Spec §5.6 has members seeing
"nothing until options exist"; a minute in which they exist and are not shown is
that sentence being true for the wrong reason.

The thing that made "schedule it" look necessary was concurrency: two answers
landing together produce two recalculations, and the later one may be computed
from inputs the earlier one has already changed. A queue serialises that.

## Decision

**The recalculation runs inline, in the same request as the answer**, and
`public.store_candidate_set` is what makes that safe: it takes the plan's row
lock, compares the `input_version` and `revision` the engine read against what
the plan is at now, and writes only if they still match. A result computed
without somebody's answer is discarded rather than stored, and the answer that
discarded it has a recalculation of its own coming.

That is the same shape as the queue, without the minute: the writers serialise
on the row lock rather than on a worker, and the compare-and-set is the thing
that decides, rather than the order two jobs happened to be picked up in.

`recalculate-candidates` stays, as §9.1 has it — **internal**, bearer
`CRON_SECRET` — for the cases no member's request covers: a member being removed
(a database trigger, with no request to attach to), a deadline passing, a
recalculation that lost its compare-and-set and left a plan a version ahead of
its set.

**A failed recalculation does not fail the answer.** The answer is written by a
separate, committed transaction; reporting an error for it would be false, and
the retry that follows would be refused as a replay of a request that worked.
The endpoint answers with the plan as it stands and says the set was not
recalculated. What is then stale is the *set*, which is the condition
`recalculate-candidates` exists to repair.

Architecture §9.1's row is corrected to say all of this.

## Alternatives considered

- **Schedule it, as §9.1 said.** Rejected for the minute, and because the queue
  buys nothing the row lock does not: the compare-and-set is needed either way,
  since a job can also be computed from inputs that have moved by the time it
  writes.
- **Inline, with the answer and the recalculation in one transaction.** Rejected:
  the engine is TypeScript and the answer is a Postgres function, so "one
  transaction" would mean holding a database transaction open across a round trip
  to the Edge Function, on the product's most frequent write.
- **Inline, failing the request when the engine fails.** Rejected: it reports an
  error for an answer that landed, and the idempotency record then refuses the
  retry as `in_progress`. The person is told to try again and cannot.
- **Inline, then also enqueueing a scheduled recalculation as a fallback** (the
  ticket's wording). Deferred rather than rejected: there is no dispatcher yet
  (S1-20), and the queue it would write to is the one that ticket builds. The
  note on S1-20 says what it has to pick up.

## Consequences

- An answer costs one engine run, which §12 budgets at under 50 ms for a plan
  the product's size allows. `submit-availability` is rate-limited per member
  because of it.
- Two answers landing together do not both count: one of the two recalculations
  is discarded, and the answer that discarded it recalculates. The set that ends
  up stored is the one computed from both.
- A plan whose inputs changed without an answer — a quorum adjustment, a removal
  — is left with a stale set until something recalculates it. `revise-plan` now
  does its own, for the same reason `submit-availability` does; the removal
  trigger cannot, and is S1-20's to pick up.
