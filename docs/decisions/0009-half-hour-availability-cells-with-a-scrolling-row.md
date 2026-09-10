# ADR 0009: Availability cells are half an hour each, and the day row scrolls

_Status: accepted · Date: 9 September 2026_

## Context

Spec §5.5 described the availability grid as "one row per day, **ten** half-hour
cells across the daily window". Those two numbers cannot both hold: ten half
hours is five hours, which is exactly the weekday evening band (17:30–22:30) and
nothing like the weekend band (09:00–22:30, thirteen and a half hours). The
sentence was written with evenings in mind and is impossible for a weekend day
or any custom band.

S1-01 through S1-03 needed a definite answer, and the S1-03 ticket put the
choice to the founder, who chose the scrolling row. This record exists because
the spec still said otherwise, and non-negotiable 1 is that product rules change
through an ADR rather than through an implementation.

## Decision

**A cell is thirty minutes. The number of cells per day is however many fit the
daily band, and the row scrolls horizontally when they do not fit the screen.**

Ten remains the number visible at once — a viewport, exported as
`VISIBLE_CELLS` — but it is a property of the layout, not of the data. A weekday
evening has ten cells and a weekend day has twenty-seven.

## Alternatives considered

- **Ten cells always, each `dailyWindow / 10`.** Keeps the sentence literally
  true and makes a cell mean 30 minutes on a weekday and 81 minutes on a Saturday.
  Rejected: "I'm free for this cell" would mean different things on different
  rows of the same plan, a person would be committing to more than they realised
  on the long days, and the candidate engine works in half hours regardless — so
  an 81-minute cell would have to be decomposed anyway, at which point the person
  painted something the system does not use.
- **Shorten the weekend band to five hours.** Makes the grid fit by making the
  product worse: the weekend daytime is exactly when a group is most likely to
  find a shared window.
- **Two cell sizes, per band.** Same objection as the first, with more code.

## Consequences

- `cellCount(plan)` varies by day, and callers must ask rather than assume ten.
  `windowsToCells` and `cellsToWindows` are indexed against that count.
- The painter row is horizontally scrollable (S1-25). That is a real interaction
  cost on the long bands, and the honest trade for cells that mean one thing.
- The cell size matches the engine's slot size, so nothing is decomposed between
  what a person paints and what is searched.
- On a day the clocks go forward some cells do not exist; `cellAt` returns
  `undefined` for those and the row greys them.
- Spec §5.5 is updated to describe this. The "ten" that remains there is the
  number on screen.
