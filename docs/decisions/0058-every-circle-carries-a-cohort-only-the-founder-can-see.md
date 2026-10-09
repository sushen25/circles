---
adr: 58
title: "Every circle carries a cohort that only the founder can see"
status: proposed
date: 2026-10-09
builds_on: [57]
---
# ADR 0058: Every circle carries a cohort that only the founder can see

_Status: proposed · 9 October 2026 · builds on [ADR 0057](0057-who-started-a-plan-is-kept-as-long-as-the-plan.md), which changed the same founder views, and adds a fact about circles that no user can read_

## Context

Spec §11.4 sets two groups of decision gates. The founder cohort: "every test
circle confirms at least one real meetup; at least 60% of members respond
without one-to-one chasing (survey) ..." and the rest of its eight. The external
cohort: "at least 50% of activated circles confirm within seven days; at least
30% of successful circles initiate another within cadence; conversions to saved
place and app arrive at value moments rather than only at the organiser gate;
willingness to pay is then tested with a real transaction."

Circles had no cohort, so the founder analytics screen (SUS-166) computed every
gate over every circle and labelled the external cohort's "pooled". The founder
circles were inside the external numbers, which is the number the spec says
decides whether to go on.

## Decision

**A mapping table in `private`, not a column on `circles`.**
`private.circle_cohorts` holds one row per circle: `cohort` (`founder` or
`external`, a closed pair that checks), `source` (`default`, the rule put it
there, or `founder`, set by hand) and `set_at`. Clients have no privilege on
`private`, and nothing that returns a circle returns the cohort.

**The rule at creation.** A trigger on `circles` gives a new circle `founder`
when its owner is on `private.allowlist` (the table the founder analytics
function already checks) and `external` otherwise. Existing circles were
backfilled by the same rule when the migration ran. Being put on the allowlist
later does not move circles already made; the founder moves them.

**Setting it.** `public.founder_set_circle_cohort(circle, cohort)` is a definer
function behind the same allowlist, checked against `auth.uid()`, and returns
nothing. There is no screen. The [founder cohorts runbook](../runbooks/founder-cohorts.md)
has the SQL for the database owner as well.

**The gates.** Every gate view carries a `cohort` column and
`public.founder_analytics` returns each gate once per cohort, so the founder
cohort's eight gates are counted over founder circles alone and the external
cohort's over external circles alone. The screen drops "pooled" and says how
many circles each cohort rests on, as a count.

**Events with no circle.** Four gates count events. An event is placed by the
circle on it, else the circle of its plan, else by the person: `founder` when
they belong to any founder circle, `external` when they belong only to other
circles. An event nobody can place is in neither cohort. The list reattach
event now carries its circle.

## Alternatives considered

- **A `cohort` column on `circles`.** The obvious place, and the same leak
  migration 0003 removed from `plans`: the table is readable by every member and
  returned by `create_circle` and the circle list, so "never shown in the
  product" would hold only while every query remembered not to select it. Column
  privileges would have fixed that for clients and made the table awkward for
  every future writer.
- **An allowlist of founder circles, with everything else external.** The same
  mapping with one fewer state, but it cannot say "the founder looked at this and
  said external", and it makes the default a join to a table that is usually
  empty.
- **A third cohort (`internal`, `test`).** Spec §11.4 names two. A closed pair
  that checks is a one-line change when a third is needed; one nobody counts is
  a row that looks like data.
- **Deriving the cohort from membership (any allowlisted member).** A founder
  who joins an external circle to look at it would turn it into a test circle.
- **A UI for setting it.** Out of scope, and a control in the product is the
  first step to showing the field.

## Consequences

- The "pooled" note is gone; both cohorts' gates are counted apart.
- A circle made before the founder was on the allowlist is `external` until the
  founder says otherwise. On a fresh database the backfill puts every circle in
  `external`, since nobody is on the allowlist yet.
- A gate rests on a person's circles when its event names none. A visitor who
  arrived without a session and never joined a circle is in neither cohort, so
  the reattach gate (already a figure that can only overstate) cannot count
  them. The screen says so.
- The funnel, the north star and the adoption lists are not split: spec §11.4
  assigns cohorts to gates only.
- Deleting a circle deletes its row (cascade); nothing else retains it.
- One more allowlisted function for `010_circles.sql` to expect, and one more
  private table. Nothing is added to a payload, a log or a generated client type.
