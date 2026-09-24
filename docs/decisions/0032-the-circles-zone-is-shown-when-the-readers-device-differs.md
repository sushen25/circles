# ADR 0032: The circle's zone is shown when the reader's device differs, not when a member's does

_Status: accepted · 24 September 2026_

## Context

Spec §5.6 asked each candidate to show its "local date and time (with zone if
any member differs)", and S1-28's confirmed screens inherited the same "with
zone" requirement. The sentence was written for the organiser: picking Thursday
at six, they should know it is four o'clock for Sam.

No client can honour it as written. A member's zone is `profiles.time_zone`,
readable by its owner alone (`profiles_select_own`). What one member may learn
about another comes through `member_profiles`, the definer view that exists
precisely to widen that, and it exposes `user_id` and `display_name` and
nothing else. Its own comment says why: "the column limit is the point, and
RLS cannot express one." Sam's zone is not in any row an organiser can read.

S1-27 (SUS-43) shipped the candidates screen answering a different question,
the reader's: "Times are Melbourne time." appears exactly when the reader's own
device is somewhere else, which is what the availability editor already did
(§9, "a member travels across time zones"). The confirm review (S1-28) does the
same. The difference between that and the spec was written into
`features/scheduling/words.ts` as a known gap, because a screen may not decide
a product rule (non-negotiable 1), and SUS-87 was opened to decide it.

Two ways to close it were on the table:

1. **Expose `time_zone` through `member_profiles`** (or a sibling view) to
   active members of the same circle: a migration, allow and deny tests, and a
   privacy judgement.
2. **Narrow the rule to the reader**, making what ships correct rather than a
   gap.

The founder chose the second on 24 September 2026.

## Decision

**On the screens whose subject is a plan's time — the availability editor,
the options, the confirm review and the two confirmed screens — the time is
written on the circle's clock, and the zone is named when the reader's own
device is in a different one, and for no other reason.**

- The test is the **device**, not the reader's profile: the case §9 names is a
  member who has travelled, and the device is where they are now. The device's
  zone never leaves the device for this; the comparison happens in the client
  against the plan's `time_zone`, which every member can read.
- **No member's zone is exposed to another member.** `member_profiles` stays
  `user_id` and `display_name`. A zone is close to a location, the view was
  narrowed on purpose, and spec §8.2's invariants are the kind that are
  structural, not procedural: a rule that a screen must not show Sam's zone is
  weaker than a database from which no screen can read it.
- The note is one sentence, "Times are Melbourne time.", under the time. It is
  the same sentence on the availability editor, the candidates, the confirm
  review and both confirmed screens, so a person away from home reads the
  same thing everywhere a time appears.
- Ordering and scoring are on instants, as before. Nothing about the engine
  changes; this record is about what a screen says.
- The rule is about those screens, not about every time the product writes.
  Circle home's cards, the plan-shared screen and the reply deadline write
  times on the circle's clock too (S1-27 decided the deadline that way, so
  two screens never disagree about when replies close) and carry no note: they
  are summaries, and each opens one of the screens above, which does. Whether
  a card should carry the sentence as well is a circle-home design question
  and is not decided here.

Spec §5.6 and §5.7 now say this. The words in `features/scheduling/words.ts`
describe the rule rather than a gap, and the confirmed screens, which had the
requirement and not the sentence, gain it.

## Alternatives considered

- **Expose `time_zone` through `member_profiles`, or a sibling view.** It is
  the only way to honour "if any member differs", and it is a migration with
  an allow and a deny test, which is not why it was declined. It was declined
  because it tells every member of a circle where every other member is, at
  the granularity of a city, for a sentence most of them will never need: the
  circles the product is for meet in one place, and the member who is
  elsewhere is the one reading, not the one being read about. The view's
  column limit is the privacy design, and a second column is the precedent
  for a third.
- **A coarse answer, "someone in this circle is in another zone", from a
  definer function.** No zone leaves the database, only a boolean. In a circle
  of two the boolean is the zone, and in a circle of three it is a guess with
  good odds. Leaks by elimination are still leaks, and the sentence it would
  buy, "one of you is somewhere else", tells the organiser nothing they can
  act on.
- **Let each member opt in to sharing their zone.** A setting nobody would
  find, for a case that already has an answer on the reader's own screen.
- **Show two clocks.** Writing every time in the circle's zone and the
  device's would double every time on the screen for the rare reader who
  needs it, and the two-clock case is exactly the one the note is for.

## Consequences

- Spec §5.6 and §5.7 are changed from "if any member differs" to the reader's
  device. §9's "a member travels across time zones: local display with the
  circle zone visible" is satisfied by the note and is unchanged.
- The gap note in `apps/app/src/features/scheduling/words.ts` is gone; what
  it described is the rule.
- `ConfirmedOrg` and `ConfirmedGuest` show the note under the time, as the
  confirm review already did. They are the screens a member opens from the
  paste-ready message, often from somewhere else, and they read the time out
  of a dark-ground headline a reader trusts.
- An organiser still cannot see that Thursday at six is four o'clock for Sam.
  Sam can, on every screen Sam opens, and Sam's answer was given on the
  circle's clock with the same note above it. What the organiser sees is who
  can make it, which is the question the product answers.
- Per-viewer rendering of emails and `.ics` files stays with S4-04 (SUS-65).
  An email is rendered once for everybody and has no device to compare
  against; a calendar file carries the instant and the calendar shows it on
  the reader's clock by itself.
- `member_profiles` is unchanged, so no migration and no new RLS test.
