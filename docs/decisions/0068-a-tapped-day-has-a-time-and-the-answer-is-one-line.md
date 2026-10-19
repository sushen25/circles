---
adr: 68
title: "A tapped day already has a time, and the answer is one line: the first screen asks only which days"
status: proposed
date: 2026-10-14
amends: [24, 37]
builds_on: [9, 13, 45, 66]
amended_by: [77, 79]
---
# ADR 0068: A tapped day already has a time, and the answer is one line: the first screen asks only which days

_Status: proposed (previous times are no longer applied on open: [ADR 0077](0077-an-answer-never-given-opens-empty-previous-times-wait-for-a-tap.md); the time of day moved onto the first screen and the per-day step into it: [ADR 0079](0079-the-time-of-day-is-on-the-first-screen-and-a-time-for-each-day-opens-in-place.md)) · 14 October 2026 · amends [ADR 0024](0024-availability-days-first-then-a-time-once.md) (what a tap does, and what the screen holds) and [ADR 0037](0037-usual-times-are-read-not-written.md) (previous times land as taps rather than behind a button); builds on [ADR 0009](0009-half-hour-availability-cells-with-a-scrolling-row.md), [ADR 0013](0013-availability-written-only-through-replace-response.md), [ADR 0045](0045-the-editor-shows-what-others-have-said-as-counts.md) and [ADR 0066](0066-the-group-sees-who-can-make-each-option-and-nobody-sees-whole-availability.md)_

## Context

The founder's first test with a first-time guest (SUS-206) said "there's a
lot going on". The screen ADR 0024 built asks one question three times (the count
on a day, "Overlaps with N others" on each line, the count over each half hour)
and explains itself four times (the subtitle, "N of the other N have answered",
the instruction box, "Others free, by the half hour"), adds a "3 of 14 days"
counter, and, for anyone with earlier answers, paints eight days before they have
touched it, so the first visit is an audit of an answer they did not give. A day
had to be ticked, then a time chosen from a card, then Done, and each day then
sat in a list of its own expandable lines, which says "pick a time once, for all
of them" and then offers eight places to pick a time.

Nothing about what is stored needs to change. The answer is half-hour cells turned
into windows (ADR 0009) and sent through `replace_response` (ADR 0013); the
counts are the aggregate ADR 0045 already returns and ADR 0066 keeps free of
names.

## Decision

**The first screen asks one thing: which days.** Top to bottom: back and the plan,
the question ("Which days could work?"), one line of guidance, the day grid, the
deadline as a footnote ("Replies close Fri 23 Oct, 8:30 pm."), then Send and
"None of these dates work for me". When any day is tapped one more thing appears
above Send: the answer as a line.

- **A tap gives the day a time.** Tapping an untapped day paints the current time
  of day on it, Evening unless the plan has none (then the first of Afternoon and
  Any time that the plan's hours contain), and tapping it again clears it. A
  tapped day is a day with times; there is no separate "ticked" state and no
  "Done". The time of day last chosen is the one a new tap gets.
- **One answer line.** The tapped days in date order ("Thu 15, Tue 20, Thu 22",
  or the first three and "and 5 more") over the time of day they all have
  ("Evenings, from 5:30 pm"). When the days differ it says the time most
  share, then the exceptions: "Evenings, but daytime on Tue 20 and 6–9:30 pm on
  Thu 22"; past three exceptions it is counts, "8 evenings, 4 daytimes"; a tie
  goes to the time the earlier day has. It replaces the "My answer" list on this
  screen.
- **Change time is a sheet.** "When, on those days?" offers **Evening** (from 5:30
  pm), **Daytime** (9 am to 5 pm) and **Any time that day** (on a plan about
  tonight, From now and Later tonight), and picking one applies it to every
  tapped day. Daytime is the domain's `daytime` shortcut (`shortcuts.ts`), morning
  and afternoon together, so the app invents no band. Each choice is clipped to
  the plan's hours, and the empty and the duplicate ones are dropped: Any time on
  a noon to 5 pm plan is Daytime. Morning and Afternoon are no longer choices; a
  morning or afternoon that previous times painted is kept and named.
- **When the plan leaves one window there is nothing to pick.** If the choices,
  clipped to the plan's band, come to one distinct window, there is no sheet and
  there are no choice buttons anywhere. The first screen names the band by where
  it sits: wholly before noon is **mornings**, wholly between noon and 5 pm
  **afternoons**, wholly from 5 pm **evenings**, anything else **days**. So an
  evenings plan asks "Which evenings could work?" (and "None of these evenings
  work for me"), a 9 am to noon plan "Which mornings…", a noon to 5 pm plan
  "Which afternoons…", and the answer line reads "Evenings, from 5:30 pm",
  "Mornings, 9 am–12 pm", "Afternoons, 12–5 pm". The link under the line is
  **Adjust hours**, and it goes straight to a plain list of the tapped days, each
  with its hours, opening to its half hours ("Your hours each evening"). A plan
  from 3 to 9 pm keeps Evening, Daytime (3 to 5 pm) and Any time, which still
  differ. The organiser's plan-band preset used to be called "Daytime" too
  (`planning/bands.ts`) but runs 9 am to 10:30 pm; SUS-210 renamed it "Days and
  evenings", so "Daytime" now means only the guest's 9 am to 5 pm.
- **Dragging across days taps them.** As in plan setup (SUS-133), a drag that
  starts on an untapped day taps every day it crosses with the current time of
  day, one that starts on a tapped day untaps them, a day that already has its
  own times keeps them, and dragging back gives a crossed day back (`strokeDays`).
  The counts change as on a tap.
- **A time for each day lives on its own screen.** The sheet's link, "A
  different time for each day", opens it, and so does **Change time** when the
  tapped days already differ. Each tapped day is a card: the day, the time it
  covers, and a row of quick choices that are the sheet's presets (Evening,
  Daytime, Any time; only the ones the plan offers, once each), which set that
  day alone. A day whose hours match no choice selects none and says "{hours},
  your own hours". **Set exact hours** opens that day's hours as **From – to**
  pairs (below). The half-hour cells stay the data model (ADR 0009) and the
  answer is still stored as windows; only the UI stops painting them.
  **Done** goes back with the days as they are; **Use one time for all days**
  goes back with the shared time, the sheet's last choice or the plan's default.
  Nothing new is stored or sent: the cells are still the answer, and Start over,
  Undo and Remove day are gone (untapping a day is how it is taken away).
- **A day's exact hours are From – to pairs, not a painted row.** Each pair is two
  time buttons ("12:00 pm" to "4:00 pm") and a remove ×. A time button opens a
  picker for that edge: half-hour steps, inside the plan's band for that day, a
  From only before its own To and a To only after its own From (a half hour at
  least: the domain keeps no minimum for a window, only that a meetup fits in one
  somewhere). "Add another time" adds a second pair for a gap in the day, and
  pairs that overlap or touch merge, because they set the same cells. The picker
  is the app's `Sheet` with a list of radios, the same on the web and on a phone,
  rather than a native time input, which offers every minute and no bounds and
  differs by platform. A thin bar under the pairs shows the band with the hours
  filled in and tick labels, decoration only and hidden from a screen reader. One
  line about the others replaces the per-half-hour counts: "Most others are free
  2–4 pm and 6–8 pm", the stretches where the count is at least three quarters
  of that day's highest (and at least one), from the same aggregate counts, three
  at most (the longest), and no line when nobody else is free that day. It
  names nobody ([ADR 0066](0066-the-group-sees-who-can-make-each-option-and-nobody-sees-whole-availability.md));
  with exactly one other answer in it is that person's stretches, the known gap
  ADR 0066 records and this does not widen. The same editor opens from each day
  card and from each row of the single-window plan's list. The painted track
  stays only on the native calendar overlay screen (Slice 3), which is its own
  design.
- **The number on a tile is everyone who could make the day, the reader once they
  tap.** Untapped it is the count of others (ADR 0045); tapped it is one more,
  `headcount` in the domain. A day nobody else could make shows a quiet zero.
  Nothing is added to what the server returns and nobody is named. Below ADR
  0045's threshold there is no number, and the guidance line stops explaining
  one.
- **Previous times land as taps.** A member with earlier answers (ADR 0037's
  amendment) opens a plan that has never been answered with the days those times
  cover already tapped and the line written, instead of an empty grid and a "Use
  my previous times" button. It is a start, not an edit: it writes no draft until
  the person changes something, it is never sent until they press Send, and it
  never replaces an answer or a draft. Availability is still never silently
  reused: what they see is what Send will send.
- **What is removed from the screen:** the "N of M days" counter, the duration
  and "N of the other N have answered" lines, the instruction box, the day tags,
  the per-line "Overlaps with N others" on this screen, and the block chips and
  Done button. "I'm easy" and the one-line privacy notice stay, below the answer
  line.

Send waits (a `disabled` primary, the repo's pattern for "not yet", not `busy`)
until a day is tapped or "I'm easy" is on; the guidance line, which says to tap a
day, is what says why.

## Alternatives considered

- **Keep the card, hide it until a day is tapped.** Still a second decision on the
  first screen, and the "Done" that lets go of the days is a step nobody wanted.
- **Ask the time of day before the days.** It puts the harder question first, and
  most answers are "these days, evenings".
- **Leave previous times behind a button.** A button on the first-time screen
  for people who have history is a second route to the same grid, and the founder
  asked for the answer to be there when it is known.
- **Show the one other person's answer as a count of one.** ADR 0066 records that
  with exactly one other answer in, the counts are that person's answer. A tile
  showing 1 on a plan where only one other has answered is that same known gap,
  not a new one; it is left as it is here.

## Consequences

- Spec §5.5 and manifesto §5.4 are rewritten in the same change. ADR 0024's tap
  and screen sections are superseded where this says otherwise; its blocks, its
  `after_work` decision and the view-state rule stand.
- The count on a tile is client-side arithmetic over the existing aggregate; no
  migration, no new field, and `replace_response` carries the same payload for the
  same answer.
- A returning member's first tap on a pre-filled day unticks it. That is the whole
  of removing a day, and it is why the "Clear these days" button is gone.
- The design canvas has eight availability boards: the first-time landing, three
  days tapped, Change time, a time for each day, the first screen with days that
  differ, the returning member and the first to
  answer. The three "Others" boards are gone, because every tile carries the
  count.
