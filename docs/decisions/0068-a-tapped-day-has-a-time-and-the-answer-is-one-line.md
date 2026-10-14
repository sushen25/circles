---
adr: 68
title: "A tapped day already has a time, and the answer is one line: the first screen asks only which days"
status: proposed
date: 2026-10-14
amends: [24, 37]
builds_on: [9, 13, 45, 66]
---
# ADR 0068: A tapped day already has a time, and the answer is one line: the first screen asks only which days

_Status: proposed · 14 October 2026 · amends [ADR 0024](0024-availability-days-first-then-a-time-once.md) (what a tap does, and what the screen holds) and [ADR 0037](0037-usual-times-are-read-not-written.md) (previous times land as taps rather than behind a button); builds on [ADR 0009](0009-half-hour-availability-cells-with-a-scrolling-row.md), [ADR 0013](0013-availability-written-only-through-replace-response.md), [ADR 0045](0045-the-editor-shows-what-others-have-said-as-counts.md) and [ADR 0066](0066-the-group-sees-who-can-make-each-option-and-nobody-sees-whole-availability.md)_

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
  ("Evenings, from 5:30 pm"; "Different times on different days" when they
  differ). It replaces the "My answer" list on this screen.
- **Change time is a sheet.** "When, on those days?" offers Evening, Afternoon
  and Any time that day (on a plan about tonight, From now and Later tonight),
  and picking one applies it to every tapped day. Only the choices the plan has
  are offered, and two that are the same hours are offered once, so an evenings
  plan offers Evening alone. Morning is not one of the three: it stays a time of
  day the half hours and previous times can make, and the answer line names it.
- **The half hours live behind "Pick exact hours instead".** It opens the ADR 0009
  half-hour grid on its own screen: a line per tapped day that opens to its cells,
  "Any time that day" and "Remove day", Start over with Undo, and the counts by
  the half hour from ADR 0045. This is the only place a day can differ from the
  others, and the only place the others' counts by the half hour are shown.
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
- The design canvas has six availability boards: the first-time landing, three
  days tapped, Change time, exact hours, the returning member and the first to
  answer. The three "Others" boards are gone, because every tile carries the
  count.
