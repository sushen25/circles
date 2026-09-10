# ADR 0011: A near-miss needs someone, unless nobody is anywhere

_Status: accepted · Date: 10 September 2026_

## Context

Architecture §12 step 7: "If nothing is eligible: return the top three
near-misses with `near_miss_reason` so the UI can offer lower quorum / wider
window / close."

Read literally, "the top three" means three whenever three starts exist. The
NoQuorum artboard shows two, and it shows two because only two of the plan's
starts have anybody free at all: everything else is a time with nobody. A screen
that says "Closest: Friday 7 pm, 3 of 6" and then "Also: Monday 9 am, 0 of 6" is
padding a list to a number. Zero of six is not near anything, and it answers
none of the three questions the buttons ask.

The opposite case is worse in the other direction. When every member replies
"none of these work", *every* start has zero attendance — and filtering them all
out left the screen with an empty list under a "widen the window" button, which
explains nothing about why there is nothing.

## Decision

**Near-misses are the highest-ranked starts that at least one active member can
make, up to three. When no start has anyone, they are the highest-ranked starts
regardless, still up to three.**

So the count is "up to three", not "three": fewer than three is the correct
answer when fewer than three times have anybody free.

They are still only computed once at least one active member has answered.
Before that the plan is waiting for replies, which is a different screen with a
different sentence, and a list of times nobody has considered is not a shortfall.

## Alternatives considered

- **Always exactly three, padding with zero-attendance starts.** Rejected: it
  contradicts the NoQuorum artboard and puts a line on the screen that carries no
  information — the reason would always be the full quorum shortfall, and the
  time is arbitrary among hundreds that are equally empty.
- **Never show zero-attendance near-misses.** The previous behaviour, and the
  reason "everyone said no" rendered as an empty list. Rejected: that is the case
  where the organiser most needs to be told what happened.
- **A distinct "nobody is free" state instead of zero-attendance near-misses.**
  A reasonable design, and more work than this decision is worth today: the
  reason code already says `quorum_short_by: n` with `n` equal to the quorum,
  which the copy layer can render as its own sentence when it wants to.

## Consequences

- `nearMisses` has length 0 to 3. The 0 case means nobody has answered yet.
- Architecture §12 step 7 gains "up to": the top three near-misses that anyone
  can make, or the top three overall when no start has anyone.
- The NoQuorum artboard keeps its two options.
