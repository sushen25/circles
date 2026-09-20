# ADR 0024: Availability is answered days first, then a time once

_Status: accepted · Date: 19 September 2026_

## Context

Spec §5.5 described the availability editor as "a mobile-friendly day list, one
row per day, half-hour cells across the daily window", with the selected range
beside each date and five shortcuts (after work, all evening, morning,
afternoon, any time that day). Manifesto §5.4 described the availability track
as that day row. S1-25 (SUS-41) built exactly that, and it is correct, but on a
phone it is heavy: a fortnight is up to fourteen rows of ten to twenty-seven
cells each, around 270 tap targets, the long weekend rows scroll sideways, and
the plan-level chips could only act on every day at once. Most answers are "these
few days, at this time of day", and the list made people say it one row at a
time.

The founder reviewed an interactive mockup on 19 September 2026 (SUS-82) and
approved a different shape: **pick the days first, then set a time once for all
of them**, with the half-hour row kept as an optional adjustment for one day.

The change is to what people tap, not to what is stored. The answer is still
half-hour cells turned into windows by `cellsToWindows`; the engine, the
contracts, `submit-availability`, drafts and resubmission are untouched. ADR
0009 stands: a cell is thirty minutes, and the adjust row scrolls on the long
bands.

## Decision

The availability editor is, top to bottom:

1. **A day grid.** The plan's days as a calendar, seven columns Monday to
   Sunday under a weekday header, one toggle button per day. A day with times
   gets the soft accent fill and a short tag (Morn, Aft, Eve, Any when its cells
   are exactly that block, Some otherwise); a ticked day gets the accent fill and
   a check. Tapping a day ticks or unticks it and sets no time. When seven
   columns would be narrower than a 44pt target at the current text size (200%
   type, a zoomed browser, a narrow phone) the grid becomes a wrapping list of
   days that name their own weekday.
2. **A time panel.** With nothing ticked, one line of guidance. With days
   ticked: which days, **Done**, and block chips — **Morning, Afternoon,
   Evening, Any time** — each with its hours as a second line. A chip is a
   checkbox over the ticked days (as S1-25's were over every day): on when every
   ticked day it exists on already has it, and tapping paints or clears it on
   all of them. Only blocks that exist for the ticked days are offered, and two
   that would paint identical cells are offered once. A block that exists on
   only some ticked days paints only those, and its chip says so. **Clear these
   days** appears when a ticked day has times. Days stay ticked after a chip is
   tapped; Done lets go of them.
3. **My answer.** One line per day with times: the date and the hours in words.
   This is where "the text is the answer" now lives, instead of beside each row.
4. **Adjust a day.** A line opens to that day's half-hour track (scrolling on
   long bands, drag on ten cells or fewer, tap otherwise, as in S1-25), with
   **Any time that day / Clear this day** and **Remove day**. One day is open at
   a time.
5. **Start over** clears every day, and offers **Undo** until the next change
   to the answer.

The blocks are the domain's shortcuts (`applyShortcut`), never hours in the
screen: Morning is `morning` (9 am–12 pm), Afternoon is `afternoon` (12–5 pm),
Evening is `all_evening` (5:30 pm to the end of the plan's band, midnight at
most), and Any time is `any_time` (the whole band). **After work is no longer
offered**: it is 5:30–10:30 pm, which is the same cells as Evening on every
band that ends by 10:30 pm, and a chip called Evening that stopped at 10:30 on a
longer band would be the surprise. The domain keeps `after_work`; nothing about
what can be stored changes.

Which days are ticked, which is open and what Start over cleared are view state.
They are never written to the device's draft and never sent.

Secondary actions inside the panel and the list (Done, Clear these days, Any
time that day, Remove day, Start over, Undo) are a **compact button**: bordered,
sized to its label, an optional icon, 44pt tall. Underlined tertiary text pushed
to the right edge of a card read as a stray link. The footer's "None of these
dates work for me" stays tertiary.

## Alternatives considered

- **Keep the day list, add day-group shortcuts** (all weekdays, all weekends)
  and "same as another day". Fewer taps for some answers, more controls for
  every answer, and the list still scrolls sideways. Left out to keep the screen
  simple; they can come back on top of blocks if testing asks for them.
- **Clear the selection automatically after a block is applied.** One fewer tap
  for single-block answers, but Afternoon plus Evening then means ticking the
  same days twice. The mockup keeps them ticked and the founder approved it;
  auto-clearing is the fallback if testing shows people miss Done.
- **A chip instead of a compact button** for the secondary actions. A chip reads
  as a choice that is on or off, and these are commands; a checkbox role on
  "Remove day" would say the wrong thing to a screen reader.
- **Five chips, keeping After work beside Evening.** On every preset band they
  are the same cells, so the dedupe would hide one of them anyway.

## Consequences

- Spec §5.5 and manifesto §5.4 are updated in the same change.
- Answering "Tue, Thu and Sat evenings" on the fixture plan is five taps (three
  days, Evening, Send), and nothing scrolls sideways unless a day is opened.
- A plan has one daily band, so every day of a plan offers the same blocks; the
  "only some of these days" case the mockup draws (Morning with a weekday and a
  Saturday ticked) cannot happen until a plan can have a band per weekday. The
  editor handles it, and it is tested with a stubbed domain.
- Afternoon ends at 5 pm and Evening starts at 5:30 pm, as the domain's
  shortcuts always have. Somebody free from 5 has to add that half hour by
  adjusting the day.
- The Slice 3 calendar overlay (SUS-58) greys cells, which now only appear in an
  open day. What it greys at the grid and block level is that ticket's to
  decide.
- The day tags are abbreviations; the full date and hours are in each day's
  spoken label and in the answer list, so nothing depends on reading them.
