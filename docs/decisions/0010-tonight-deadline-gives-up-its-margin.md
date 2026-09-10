# ADR 0010: Tonight's deadline gives up its margin rather than the plan

_Status: accepted · Date: 10 September 2026_

## Context

Spec §5.3 sets the response deadline defaults, and tonight's is the tight one:
"the earlier of 60 minutes after creation and 30 minutes before the last
possible start. Editable, never after the last possible start."

Two of those clauses can disagree. At 8:45 pm, a three-hour meetup in a band
running to midnight has exactly one possible start — 9 pm — so the default is
8:30 pm, fifteen minutes before the plan exists. A deadline in the past closes
replies the instant it is saved.

The spec says what the default *is* and what its upper bound is. It does not say
what happens when the default alone is unreachable, and the implementation had
quietly picked an answer: `tonight()` refused to offer the preset at all. That
made the preset unavailable whenever the last possible start was under half an
hour away — a minimum response time, which §5.3 does not have and which
contradicts the same sentence's promise that the organiser may put the deadline
anywhere up to the last possible start. Nothing in the spec stops an organiser
setting a deadline fifteen minutes out; the code stopped them by refusing the
plan that would have carried it.

## Decision

**When tonight's default deadline would land at or before creation, the default
becomes the last possible start.** The plan is still offered. Only a plan with
no future start at all is refused.

The margin is a default's preference, not a floor. It applies whenever there is
room for it and yields when there is not, because the alternative — refusing —
denies the organiser a plan the spec permits them to create.

The upper bound is untouched and remains absolute: a deadline is never after the
last possible start, so when the last possible start is not after creation there
is no valid deadline and `defaultDeadline` returns `undefined`.

## Alternatives considered

- **Refuse the plan** (the previous behaviour). Rejected: it turns a default
  into a rule, and it produces the reported bug — an organiser who explicitly
  chose a band running to midnight at 8:45 pm is told it is "too late for
  tonight" when there is a viable three-hour meetup starting at nine.
- **Floor the deadline at creation.** Rejected: a deadline equal to the moment
  the plan is saved is a deadline that has already passed by the time the message
  reaches the group chat. It is the shape of an answer, not an answer.
- **Amend §5.3 to shorten the margin.** Rejected: the margin is right in the
  case it was written for. The problem is only what happens when it cannot hold.

## Consequences

- A tonight plan can be created with as little as one half-hour slot of reply
  time. The organiser sees the deadline before they send it and can edit it, and
  the plan says how long people have.
- `hasFutureStart` is now the only thing that can refuse the tonight preset, so
  the reason a refusal gives is always the clock.
- Spec §5.3 gains the missing sentence: the deadline default is capped at the
  last possible start and never lands before creation.
