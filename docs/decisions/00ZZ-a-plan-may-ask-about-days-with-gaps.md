# ADR 00ZZ: A plan may ask about days with gaps between them

_Status: proposed · 1 October 2026 · amends [ADR 0030](0030-a-plan-may-ask-about-up-to-thirty-days.md) and spec §5.3_

## Context

The custom date picker took a range: tap the first day, tap the last, and
every day between was asked about. An organiser who meant "the next two
weekends" or "any evening but Wednesday" could not say so, and the group was
asked about days that were never on offer. The founder reviewed a mockup on
1 October 2026 and approved a picker that **selects specific days**: a tap
toggles one, and dragging across days paints them in (SUS-133).

That changes what a plan is. A plan was `window_start` and `window_end`, and
"every day between them" was assumed by the database's checks, the candidate
engine, the availability editor's rows, the plan's title and the emails. The
founder settled four questions on 1 October; two differ from the ticket's
recommendations.

## Decision

1. **The days are a table, and no rows means every day.** `public.plan_days
   (plan_id, day)` holds the days a plan asks about **only when it has gaps**.
   A plan with no rows asks about every day from `window_start` to
   `window_end`, which is every preset and every plan stored before this — so
   nothing is backfilled, the four presets write nothing, and an old plan
   reads exactly as it did. `window_start` and `window_end` stay the first and
   last day asked about, so the last possible start, the thirty-day check,
   retention (a plan's rows go with it, `on delete cascade`) and the analytics
   views read what they always read. One set of days has one stored form: a
   deferred constraint trigger (`enforce_plan_days`) holds that, when there are
   rows, the first is `window_start`, the last is `window_end`, and at least
   one day between them is missing. The domain writes windows the same way
   (`windowFromDays`), and everything that walks a plan's dates calls
   `askedDays`.

2. **Taking away days nobody picked keeps everyone's answers.** Changing the
   days is a new question, as a changed window is (ADR 0017) — except that
   removing days on which **no answer to the current revision has times**,
   the editor's own included, keeps every answer and starts no revision. That
   is a new transition, `narrow`: it may move the window's ends inward and
   carry a quorum or a deadline, never the band or the duration; it emits
   `planning.plan_revised` with `action: 'narrow'`, which asks nobody again,
   and it recomputes the candidate set as a quorum change does. Adding a day,
   or removing a day somebody picked, is an `edit`. `revise_plan` decides,
   under the plan's lock, from `public.picked_days` (dates only, never whose;
   the organiser's alone), and the edit screen's preview asks the same
   function, so the screen says which applies before saving: "Nobody has to
   answer again: nobody picked the days you're taking away" or the usual
   re-ask warning.

3. **"Try a wider window" asks about every day for thirty days from the
   first, and the gaps go.** It sends the new ends and no days, which
   `revise_plan` reads as every day. The no-quorum screen's line and its
   preview say "every day, not only the days picked" on a plan with gaps.

4. **The fewest days is one.** A one-day window was already valid; nothing
   changes.

The cap is unchanged in substance and restated: **the first and last day may
be up to thirty days apart** (ADR 0030), so a plan never asks about more than
thirty days. The picker fades days outside that reach once something is
picked, and a stroke stops there.

The picker itself: each day is a toggle button with its full date and state
in its label, so a screen reader or a keyboard picks days one at a time and
never needs the drag. A drag that starts sideways is a stroke and may then
move down through the weeks; one that starts vertically scrolls the page (the
reasoning of ADR 0009). The stroke fills in calendar order and skips days
already gone. `DayGrid` gains an optional `onPaint`; absent, the grid is what
it was, which is the availability editor's.

## Alternatives considered

- **An optional `plans.window_days date[]`** (the ticket's recommendation).
  As cheap, and a column cannot be joined, constrained per day or read by
  PostgREST's embedding the way a table can. The founder chose a table.
- **Backfill a row for every day of every stored plan.** One rule ("rows are
  the days") at the cost of a migration over every plan, a row per day for
  every preset forever, and a second form of "every day" to keep in step with
  the window. No rows meaning every day is the form every existing plan is
  already in.
- **Any change to the days is a new question** (the ticket's recommendation:
  one rule is easier to trust than two). The founder judged that taking away a
  day nobody can make should not cost six people a second reply.
- **Rows per revision.** The days are the plan's question as it stands; old
  revisions' answers are cleared with them, so nothing reads an old
  revision's days.

## Consequences

- Migration 0032 adds `plan_days`, its select policy (the plan's circle) and
  no write grant to anybody; `create_plan` and `revise_plan` take `p_days`;
  `engine_input` and `dispatch_context` carry the days; `enforce_window_shape`
  refuses a window on a day the plan does not ask about; `planning.transitions`
  is reseeded with `narrow`.
- The engine offers no candidate on a day that is not asked about, and the
  input hash includes the days only when there are gaps, so every stored
  plan hashes as it did.
- The availability editor has a row for each day asked about and none between;
  the grid places days by weekday, so the gaps are blanks.
- Words: a window with gaps is said as its runs ("Thu 17 – Sun 20 Sep, Tue 22
  Sep"), or as "9 days between Thu 17 Sep and Sun 27 Sep" past three runs —
  the picker's summary, the edit chips, the rescheduled screen and the
  asked-again email. The plan's title stays first to last ("17 Sep – 27 Sep"),
  which is still true; "in the next two weeks" is said only of a fortnight with
  no gaps.
- Plan another reads a last plan's span, not its days, to suggest a preset; a
  quiet ask has no custom dates and so never has gaps.
- `plan_created` gains `has_gaps` and `days_asked` (a flag and a count, never a
  date), optional so earlier events are the same event.
- The drag has been checked in desktop Chromium; iOS Safari, Android Chrome and
  the native builds are checked by hand before release (the responder and the
  surrounding `ScrollView` must agree about who owns a diagonal drag).
