# ADR 0030: A plan may ask about up to thirty days

_Status: accepted · 24 September 2026_

## Context

Spec §5.3 capped a custom window at 14 consecutive days, the length of the
longest preset. The cap was set with the costs in view: the availability
painter draws a row of cells per day (ADR 0009), the candidate engine's budget
is quoted per fortnight (§12), and a fortnight was thought to be as far ahead
as a group chat plans.

Reviewing S1-26 (SUS-42), the first screens on which an organiser picks their
own dates, the founder found the fortnight too short for real groups. A dinner
three weeks out is ordinary; a fortnight from today often misses the weekend
people are actually free; and a custom picker whose cap is the same as the
biggest preset offers nothing the presets did not.

## Decision

**A window may span up to 30 consecutive days, inclusive.** `MAX_WINDOW_DAYS`
is 30 in the domain, `plans_window_length` allows 29 days between the ends in
the database (migration 0023), and the custom picker's copy says thirty.

**The presets do not move.** Tonight, this weekend, next 7 days and next 14
days are what they were, the first run still asks about the fortnight, and
"in the next two weeks" is still said of it. The fortnight is now its own
constant (`FORTNIGHT_DAYS`), because two things had been sharing one number:
how long the default preset is, and how long any window may be. Only the
second changed.

**"Try a wider window" runs out to the new cap.** The no-quorum screen's one
tap widens the plan to thirty days from its first day, as it widened to
fourteen before, previewed first because a wider window asks people again.

## Alternatives considered

- **21 days.** No less arbitrary than fourteen, and the founder's cases were
  about the month, not the third week.
- **No cap.** The painter's grid and the engine's work grow with the days, and
  a cap is what keeps the answer screen finite. Thirty is a month, which is
  as far ahead as the product's own cadences look (§5.2).
- **Moving the presets too.** Not asked for. The first run is about defaults
  that need no thought, and the fortnight was chosen for that.

## Consequences

- Migration 0023 replaces `plans_window_length`; nothing stored can violate a
  wider rule, so it applies without a validation pass.
- The engine at eight members across thirty days is measured in the domain's
  performance test alongside the fortnight. §12's budget still quotes the
  fortnight as the benchmark; thirty days is not a new budget.
- A thirty-day window paints as a longer row. The painter already scrolls; a
  custom window this long is the organiser's choice, made on a screen that
  names the count.
