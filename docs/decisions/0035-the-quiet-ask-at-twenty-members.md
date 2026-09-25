# ADR 0035: The quiet ask at twenty members — its threshold, its stop time, and what it does beside an open plan

_Status: accepted · 25 September 2026_

## Context

S2-01 (SUS-49) writes the quiet ask's rules into `packages/domain` (spec §5.4).
Four things had moved underneath the ticket since it was written.

- **The member cap went from twelve to twenty** (ADR 0012). ADR 0012 said the
  quiet-ask threshold "is a proportion of the circle, so it moves with the cap
  on its own". It is not: `min(3, active members)` is three for every circle of
  three or more. Carried over, a circle of twenty would open a plan that asks
  all twenty for times on the strength of three people — 15% of it, where the
  rule was drawn to mean a quarter.
- **The caps** — one open ask per member, three per circle per seven days —
  were also sized against twelve.
- **A circle has one open plan at a time** (ADR 0033, SUS-89). A quiet ask
  still `seeking` is not an open plan, so a named plan can be started beside
  it; if the ask then reaches its threshold, `threshold_reached` refuses with
  `plan_in_progress`. SUS-89 left what the ask does then to this ticket.
- **The stop-time rule could not be met as written.** §5.4 says the stop time
  "is always before the window it asks about", and offers "tonight 9 pm" and
  "when the window starts". A tonight window opens at the next half hour, so
  9 pm is inside it; a next-7-days window opens today, so no later stop time is
  before it; and "when the window starts" is not before the window's start.
  The ticket's "strictly before the window's first possible start" had the same
  problem.

## Decision

**The threshold is `min(n, max(3, ceil(n / 4)))`**, where `n` is the circle's
active members when the ask is made (`quietThreshold`). Three for every circle
of up to twelve — exactly what §5.4 had, for the circles it was designed
for — and a quarter of the circle above that: four at 13–16, five at 17–20.
Computed once and stored in `plans.quiet_threshold`; it does not move as
people join or leave, because a threshold that moves while answers arrive is
one somebody can watch move.

**A circle of one cannot make a quiet ask** (`nobody_to_ask`). Its threshold
would be one, which the initiator meets alone, and the database's
`plans_quiet_threshold` already refuses a threshold under two. ADR 0022's
remark that a first-circle quiet ask "opens at once" described a row that could
never be stored; there is nothing to deadlock because there is no ask.

**The caps stay where they were, on purpose.** One open (`seeking`) ask per
member per circle, and three per circle in any rolling seven days, every
state counting — a withdrawn or expired ask still prompted everybody. The
circle cap bounds what each member *receives*, and a member of a circle of
twenty reads the same three prompts a week as one of a circle of six; scaling
it with the roster would make the bigger circle the noisier one. A member who
has muted quiet asks is refused for that before anything that depends on other
people's asks, so a refusal never tells them asks exist that they were not
shown.

**A stop time is valid when it is after now and before the last possible
start** (`isValidStopTime`). That is what "before the window" protects: an ask
that could open after the meetup can no longer happen is an ask about nothing.
It is the bound the response deadline already lives under (§5.3), and like the
deadline it has no minimum (ADR 0010). The options are resolved server-side
from a name, never taken as an instant from a client:

| Option | Offered for | Resolves to |
| --- | --- | --- |
| `tonight_9pm` | every window | 9 pm today, plan zone |
| `friday_midday` | this weekend | noon on the Friday before a weekend that starts on its Saturday |
| `two_days` | next 7 / 14 days | 48 elapsed hours from now |
| `when_window_starts` | every window | the first day's band start |

Only the valid ones are offered; the starred chip is the window's usual choice
when valid (Friday midday, two days, tonight 9 pm) and the first valid one
otherwise. "Tonight, 9 pm" for any window follows §5.4, which qualifies only
Friday midday, and the SparkSetup artboard, which shows it on a weekend ask.
A quiet ask has no custom window.

**An ask at its threshold beside an open plan is held.** It stays `seeking`,
shows nothing different to anybody — the initiator included — and opens at the
first moment both hold: the count is met and the circle has no plan
`collecting` or `ready`. That moment is found on every interest answer (a
repeat included) and on the dispatcher's sweep (`nextQuietStep`). Before its
stop time it may open; from its stop time it can only expire, and a held ask
that is still held then closes exactly as one below its threshold does. The
answerer is told `thresholdReached: false` either way, so nothing distinguishes
"held" from "not yet".

**Interest closes when the ask opens, and the count is fixed there.** After the
threshold nobody answers the quiet question any more; the people who were not
keen add their *times* (§5.4.6), which is a different question. So the keen
count the circle sees after threshold is a constant for the life of the plan,
and two reads of it cannot be differenced to learn who answered in between.

**Withdrawing is the table's `seeking → cancel`** (guarded `member` +
`initiator`, SUS-24), not `expire` with a `withdrawn` flag as the ticket
described. A flag on the plan row would be readable by the whole circle
anyway; `quietView` shows a withdrawn ask and an expired one identically to
everyone but the initiator.

**The owner's fallback waits for the response deadline.** The table's
`keen_initiator_or_owner` guard admits the owner at any time, so the nudge can
never lead to a refusal; `acceptOrganiser` adds that before replies close the
role belongs to the people who said they were keen. An owner who is keen
volunteers like anybody else.

**A refusal code must not let the initiator be inferred**, wherever it is
rendered. `TransitionError` and the quiet refusals carry no message, so the
rule falls on the app's copy, email templates and function JSON:
`already_asking` may be said to the person it is about and must never be
recorded against their id where a second person can read it, and the same is
true of an `accept-organiser` source of `initiator`.

Spec §5.4 says all of this in its own words.

## Alternatives considered

- **Keep three.** Simple and already in the spec, but it makes a circle of
  twenty the easiest place to open a plan, when it is the place a plan costs
  the most people an answer. It is also what ADR 0012 said was not happening.
- **A third, `max(3, ceil(n / 3))`.** Keeps the floor but moves the threshold
  for circles the designs were drawn for — nine to twelve would need four — and
  nothing about those circles changed.
- **Tie it to the quorum default** (`ceil(n × 0.6)`, twelve of twenty). A quiet
  ask is a lighter signal than a quorum by design: "a few of us are keen", then
  find a time. Twelve keen answers before anything happens is a different
  feature.
- **Scale the caps with the circle.** Rejected above: the cap is about the
  recipient, whose load does not change with the roster.
- **Beside an open plan, expire the ask at once, or tell the initiator.**
  Either one tells somebody the count was met while it was still hidden, which
  is the one thing §5.4.3 rules out before threshold. Holding costs nothing: the
  ask was going to wait until its stop time anyway.
- **Beside an open plan, cross only on the next keen answer.** An ask whose
  keen answers are all in would never get one, and would sit held until it
  expired even after the open plan finished. Any answer, and the sweep, re-check.
- **Keep counting interest after the threshold.** The Volunteer artboard's
  "3 of 6 are keen so far" reads that way. But a count that moves by one while
  somebody watches names whoever just answered, which is the differencing
  ADR 0012's review asked this ticket to rule out.

## Consequences

- `packages/domain/src/planning/`: `quiet.ts` (threshold, caps, interest),
  `quiet-stop-time.ts`, `quiet-threshold.ts` (crossing, held, the dispatcher's
  step), `quiet-lifecycle.ts` (organiser, expiry, withdrawal) and
  `quiet-view.ts`, the single place a client reads quiet state from. No
  migration and no function in this change; those are S2-02's (SUS-50).
- S2-02 must mirror, in SQL: `quiet_expires_at` not null and before the last
  possible start while `seeking` (as a `case`, SUS-24's note); a keen
  `private.plan_interest` row for the initiator at creation, because the
  `threshold` guard counts those rows and nothing else; the window preset kept
  or passed, because the deadline at threshold is defaulted from it; held asks
  re-checked when a circle's open plan leaves `collecting` or `ready`; interest
  refused once a plan has left `seeking`; the owner's wait for the deadline in
  `accept-organiser`; and the source never stored or put in an event payload.
- S2-03's copy (SUS-51): SparkSetup's "If three people are keen" and
  SparkWaiting's "3 of 6" take the stored threshold; Volunteer's "so far" no
  longer holds; a circle of one does not offer "See if people are keen".
- ADR 0012's line about the threshold is corrected by this record, and
  ADR 0022's remark about a circle of one is superseded by it.
