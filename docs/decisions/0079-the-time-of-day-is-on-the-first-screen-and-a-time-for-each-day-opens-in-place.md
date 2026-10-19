---
adr: 79
title: "The time of day is on the first screen as pills, and a time for each day opens in place"
status: accepted
date: 2026-10-19
amends: [68]
builds_on: [9, 13, 45, 66]
---
# ADR 0079: The time of day is on the first screen as pills, and a time for each day opens in place

_Status: accepted · 19 October 2026 · amends [ADR 0068](0068-a-tapped-day-has-a-time-and-the-answer-is-one-line.md) (the first screen's answer block, and where the per-day step lives); builds on [ADR 0009](0009-half-hour-availability-cells-with-a-scrolling-row.md), [ADR 0013](0013-availability-written-only-through-replace-response.md), [ADR 0045](0045-the-editor-shows-what-others-have-said-as-counts.md) and [ADR 0066](0066-the-group-sees-who-can-make-each-option-and-nobody-sees-whole-availability.md)_

## Context

A second round of founder testing on the screen ADR 0068 built (SUS-236), with a
friend answering through Messenger, said two things. "Change time" beside a list
of dates read as _change the dates_: she did not know it set the time of day. And
there was too much text explaining how to choose; she liked the buttons on the
sheet and asked why they were not on the first screen ("a 'what time?: day,
evening, any' and the time range is probs all u need").

The sheet was hidden to keep the first screen light. It is the sheet that made it
heavy: the line of tapped days, the Change time link and the sheet were three
things explaining one choice that could be visible. The grid already says which
days are tapped.

Nothing stored changes. The answer is half-hour cells turned into windows
(ADR 0009) and sent through `replace_response` (ADR 0013).

## Decision

**Once any day is tapped, the first screen shows the time of day, not a line
about it.** The answer block, under the deadline footnote and above "I'm easy":

- **"When, on those days?"** with the number of tapped days, "10 days", at the
  right; a row of pills, a radiogroup, **Evening · Daytime · Any time**; and one
  line under it with the chosen one's hours ("From 5:30 pm", "9 am–5 pm", "Any
  time") and **Not the same every day?**. The choices are ADR 0068's, unchanged:
  clipped to the plan's hours, the empty and the duplicate ones dropped, a plan
  about tonight offering From now and Later tonight, and no row at all when the
  plan leaves one window. A tap on a pill applies it to every tapped day, as the
  sheet's did. Hours that match no pill (a day set by the half hour, the same on
  every tapped day) select none and are the line.
- **The day list and the Change time link are gone, and so is the sheet.** The
  answer line of ADR 0068 ("Thu 15, Tue 20, Thu 22 and 7 more" over the time)
  is replaced by the count and the hours line; its exceptions sentence ("Evenings,
  but daytime on Tue 20") is not needed, because the days that differ are the
  list.
- **The guidance line is shorter:** "Tap or drag across the days. The number is how
  many can make it." Below ADR 0045's threshold there is no count sentence.
- **Not the same every day? swaps the block in place.** The heading, pills and
  hours line are hidden; in their place **A time for each day** with **Same for
  every day** at the right, then one row for each tapped day, in date order: the
  day, small pills for the choices the plan offers that exist on that day, and a
  round clock button ("Exact hours, Thursday 22 October"). A day whose hours
  match no choice selects none, lights its clock (accent border, soft fill) and
  says its hours under its name. **Same for every day** collapses the block on
  the last choice made for all days, or the plan's default, as "Use one time for
  all days" did. There is no Done: changes apply as they are made. This is a
  view state, never stored or sent, and the block opens in it when the days
  already differ (a draft or an answer set by day).
- **The clock opens that day's hours on the app's sheet.** The day and its hours,
  one line ("Set when you're free. Add a second time if there's a gap."), and the
  From – to editor of ADR 0068 unchanged (the pairs, the per-edge picker, Add
  another time, the bar, and "Most others are free …", which names nobody:
  ADR 0066). **Done** closes the sheet, as does dismissing it. **Back to Evening
  instead** drops the exact hours for the choice the day had before the clock was
  tapped, and is not shown for a day that had hours of its own.
- **A plan with one window keeps "Adjust hours"** where the block has "Not the
  same every day?". It opens the same list without pills (the hours stand where
  they would be), and each day's clock opens the same sheet.
- **The per-day step is not a screen of its own.** SUS-209 gave "A time for each
  day" an entry in the browser's history (`?step=hours`) so that Back returned to
  the first screen. With the list in place and the sheet a dialog, there is no
  screen to go back from: the address does not change, Back leaves the page as it
  does from any other state of the first screen, and the handing of the answer
  between two editors (`hoursStep.ts`) is removed.

## Alternatives considered

- **Keep the sheet and rename the link** ("Change time of day"). It fixes the
  misreading and leaves the three things explaining one choice.
- **A segmented control with the hours inside each segment** ("Evening, from 5:30
  pm"). The hours are the same on every day it is offered, so they are said once,
  under the row, and the pills stay short enough for three across a phone.
- **Keep the per-day step on its own screen, with a button for the sheet.** A
  second screen for what is now a list under the first.
- **Always show the per-day rows.** Most answers are "these days, evenings"; ten
  rows of pills is the screen the founder's first test said was a lot going on.

## Consequences

- Spec §5.5 and manifesto §5.4 are changed in the same change. ADR 0068's
  "Change time is a sheet", "One answer line" and "A time for each day lives on
  its own screen" are superseded where this says otherwise; its tap rule, its
  single-window rule, the From – to editor, the counts and the stored shape
  stand.
- `ChangeTimeSheet`, `ExactHoursScreen`, `DayCard`, the answer line's day list
  and the history step (`hoursStep.ts`, `useHoursStep.ts`) are removed, with the
  copy only they used (`change_time`, `different_time_each_day`, `use_one_time`,
  `exact_title`, `exact_body`).
- No migration, no new field, no new event; `replace_response` carries the same
  payload for the same answer.
- The design canvas retires `AvailabilityTime`, `AvailabilityAdjusting` and
  `AvailabilityMixed` and draws the three states of the block: the time inline, a
  time for each day, and a day's hours on the sheet.
