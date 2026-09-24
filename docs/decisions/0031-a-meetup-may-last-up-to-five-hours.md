# ADR 0031: A meetup may last up to five hours

_Status: accepted · 24 September 2026_

## Context

Spec §5.3 allowed a plan's duration to be 60, 90, 120 or 180 minutes, and a
circle's default the same set. The set is what the "How long" chips offer,
what `plans_duration` and `circles_default_duration` accept, and what the
band-fits rule (`plans_band_fits`, `band_shorter_than_meetup`) measures a
day's hours against.

Reviewing S1-26 (SUS-42), the founder wanted a longer top: a day out, a long
lunch that runs into the evening, a game and the meal after it. Three hours
undersells those, and an organiser who picks "3 hrs" for a five-hour plan
gets candidate times that end too early to be honest.

## Decision

**240 and 300 minutes join the set.** `DURATIONS` is 60, 90, 120, 180, 240
and 300; the contracts' `DurationMinutes` and both database checks follow
(migration 0023); the chips gain "4 hrs" and "5 hrs", and the first-run card's
wording gains "About 4 hours" and "About 5 hours".

**Nothing else about time moves.** Starts are still on the half hour, the
band still has to hold the meetup, and the deadline is still never after the
last possible start. The evenings band (5:30–10:30 pm) holds a five-hour
meetup exactly; the weekend band holds it easily; "tonight" late in the
evening will refuse a long meetup as `band_shorter_than_meetup`, which is the
same rule saying the same true thing.

## Alternatives considered

- **Any number of minutes.** The chips, the half-hour grid and the two
  database checks all want a set, and a free field invites "75".
- **Up to eight hours, or all day.** Not asked for, and a whole day is a
  different kind of plan than the product describes (§5.3 asks about hours of
  a day, not days).

## Consequences

- Migration 0023 replaces `plans_duration` and `circles_default_duration`.
- A circle's default duration may now be 240 or 300. No screen sets it yet
  (S1-23 left the picker out); `create-circle` takes what the contract allows.
- The "How long" row is six chips. On the narrowest phone that wraps to a
  second line, which `Chips` already does.
