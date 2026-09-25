# ADR 00XX: A member's usual times are worked out when they are read, not written when they answer

_Status: proposed · 25 September 2026_

## Context

ADR 0005 keeps willing windows for twelve months and derives a coarse "usual
day-parts" summary per member and circle that outlives them, used only to
pre-fill that member's own next answer. S1-12 built the half that runs at
night: `public.member_dayparts` holds a running total, and before retention
deletes a window it adds that window's counts to the stored total. The table
therefore holds **only what has already been deleted** — the architecture's
row for it says so — and no client or function may write it.

S2-06's description planned the other half as a write: a small `security
definer` function, called on each `response_submitted`, keeping the summary
current as people answer. That is a second writer to a table whose one
writer adds counts exactly once, before deletion. A per-answer writer has to
avoid counting a window that retention will add again when it ages out, has
to undo what it added when an answer is changed or replaced, and has to
follow a revision that clears an answer. Each of those is a place for the two
writers to disagree, and a summary that is wrong in the direction of "you
usually say yes to Saturdays" is the kind of pre-fill that feels like being
watched.

Meanwhile everything the per-answer write would store is still in the
database, readable by exactly the person it is about:
`plan_responses_select_own` and `willing_windows_select_own` let a member read
their own answers and windows in a circle they belong to, and nothing else.

## Decision

**The usual is computed when the editor reads it, from two sources that never
overlap:** the stored counts in `member_dayparts` (windows retention has
already deleted) and the member's own retained answers to the circle's other
plans (the windows it has not). The domain's `usualDayparts` adds them.
Nothing is written when somebody answers, and `member_dayparts` keeps its one
writer.

Two rules come with it, both in the domain:

- A usual needs **at least two earlier answers with times** in the circle. A
  stored summary counts as one, because it proves there were answers but not
  how many.
- A daypart is usual when it was offered **at least half as often as the
  most-offered one**.

The editor offers **Use my usual times** only on an empty answer, only when
the usual paints something on this plan, and never sends it: it paints the
blocks of the same name (Morning, Afternoon, Evening) on the plan's weekdays
or weekend days, inside the plan's hours, and the person changes it and
presses Send as for any other answer. It counts as their edit, so it writes a
draft like any other change. It overrides nothing the preset chose: the
plan's band is the plan's, and a member's habit cannot widen it.

## Alternatives considered

- **A definer function writing the summary on each answer** (the ticket's
  plan). Rejected for the reasons above: two writers to one running total,
  each able to double-count or miss the other's work, to store what can
  already be read.
- **Fold the usual into `resolvePreset`.** Rejected in S1-02's note: the
  presets answer from the clock and the zone alone, so a circle with no
  history gets honest defaults, and a member's habit is theirs, not the
  plan's.
- **Recompute `member_dayparts` from scratch on read.** Impossible: the
  windows it summarises are gone, which is the point of it.

## Consequences

- No migration, no SQL function, no new grant. The read is two small
  queries and one per earlier plan's answers, all through RLS.
- The pre-fill is as fresh as the member's last answer, including one given
  a minute ago on another plan.
- The per-answer half of S2-06 item 4 is not built, and does not need to be.
- A member who has answered only flexibly, or not at all, gets the plan's
  defaults and no button. Nobody who has not answered is ever scored by it
  (ADR 0005).
