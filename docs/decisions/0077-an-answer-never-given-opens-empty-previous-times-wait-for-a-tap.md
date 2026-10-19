---
adr: 77
title: "An answer never given opens empty: previous times are not applied on open, they wait for a tap"
status: proposed
date: 2026-10-16
amends: [37, 68]
builds_on: [5]
---
# ADR 0077: An answer never given opens empty: previous times are not applied on open, they wait for a tap

_Status: proposed (the explicit tap now exists: SUS-227, below) · 16 October 2026 · amends [ADR 0068](0068-a-tapped-day-has-a-time-and-the-answer-is-one-line.md) and [ADR 0037](0037-usual-times-are-read-not-written.md) (previous times are no longer applied when the editor opens); builds on [ADR 0005](0005-willing-windows-retained-12-months.md)_

## Context

[ADR 0068](0068-a-tapped-day-has-a-time-and-the-answer-is-one-line.md) made
previous times "land as taps, not behind a button": a member with an earlier
answer in the circle opened a new plan with the days those times cover already
tapped and the answer line already written. The founder's test (16 October 2026,
SUS-226) said "when a guest opens a plan it preselects all available options,
make it not do that". The reproduction on the local stack found exactly one
cause. A brand-new guest opened the editor with no day tapped; a returning guest
with one earlier answer opened a new plan with two days tapped. Nothing else
taps on open: a plan with one choice of time gives a tapped day that time, but
the tap is the person's.

The prefill makes the first visit an audit of an answer the person did not give,
which is what ADR 0068 set out to remove from the first screen. It is also the
one place the app answers a question for somebody before they have looked at it.

## Decision

**An answer that has never been given opens empty.** No day is tapped, no answer
line is written and Send is disabled until the person taps, whatever they offered
before in the circle. A stored answer, "none of these" or an unsent draft still
reopens as the person left it ([ADR 0024](0024-availability-days-first-then-a-time-once.md)).

**Previous times are kept for an explicit tap, not applied.** The read
(`usePreviousTimes`, the `previous_dayparts` function of ADR 0037, wrapped by `usualTimes`) and the editor's
`usual` action stay in the code, tested, and nothing calls them on open. The
founder has decided they come back as a button the person presses ("Use my
usual days"). The first version of this record left that to a follow-up; it is
SUS-227 and is described under "The tap" below.

**The measurement stays truthful.** `availability_started.usual_offered` is true
exactly when the tap was on show as the editor opened, and false otherwise;
`availability_submitted.usual_used` is true exactly when the tap was used and
the answer sent with it still in force. The fields are unchanged and at
version 1. The start waits for the read to settle, so the flag is a yes or no, but never
for long: after a moment it is sent without the flag, which says "unknown"
(ADR 0045), and a guest who has nothing to read (no backend, a stored answer, a
draft) is not waited for.

### The tap (SUS-227, 16 October 2026)

**Before the tap, nothing is tapped.** Under the deadline footnote, where the
answer block will appear ([ADR 0079](0079-the-time-of-day-is-on-the-first-screen-and-a-time-for-each-day-opens-in-place.md)), sits a quiet pill, **Use my usual days**, with a small undo-style icon, and under it one line that
says what the usual is in words, from the parts the read returned, so the tap is
never a surprise: "Weekday evenings and weekend afternoons, from your last plans
in this circle." A group with all three parts of the day reads "any time on
weekdays". The words are the copy file's; no date, count or day-part reaches an
analytics event.

**It shows only to someone who has answered in this circle before, whose usual
days fall inside this plan (`canUseUsual`), and who has not answered this plan
yet.** A first-time guest, a guest with a stored answer (including "none of
these") and a guest reopening an unsent draft never see it, and the first two
make no request for it. A failed read offers nothing. It disappears once any
day is tapped by hand, and stays gone for the rest of that opening.

**After the tap** the usual days are tapped with their usual times (the `usual`
action), the answer block shows as for any other answer, and under its hours line
reads "Filled in from your usual days. **Undo**". Days whose usual times share a
time of day light that pill; days whose usual times differ open the block as "A
time for each day", each with its own. Send is enabled. Undo returns to
nothing tapped, brings the offer back, and takes `usual_used` back to false.
From the tap on everything is an ordinary answer: days tapped off or on, the
time-of-day pills, a time for each day, Send. The note goes as soon as the person
changes a day or a time (looking at each day's hours and going back changes
nothing, so it stays);
`usual_used` stays true, because the answer began from the tap (SUS-159), unless the answer sent is "I'm easy", which carries none of the days. A reload restores the days from the draft but not the note or the flag, so an answer begun from the tap and sent after a reload says `usual_used: false`: a known undercount, not worth carrying in the draft.

## Alternatives considered

- **Retire the two fields.** Rejected: the tap reuses them, and a retired
  field would have to come back at a new version.
- **Delete the read and the `usual` action.** Rejected: the founder wants the
  explicit tap, and rebuilding the read costs more than keeping a tested unit.
- **Keep the prefill but ask first.** That is the button of ADR 0037, which ADR
  0068 removed because the first screen carried too much; SUS-227 brings back a
  quiet tap instead, drawn on the canvas (`AvailabilityReturning`,
  `AvailabilityReturningTapped`), with nothing tapped until it is pressed.

## Consequences

- The first screen opens the same for a first-time and a returning guest, bar
  the one offer a returning guest has under the deadline footnote.
- `usePreviousTimes` has one caller, the editor, which asks for the read only
  when the offer could be made. `useStartedEvent` stays in the same file.
- Spec §5.5's "Previous times" paragraph is rewritten in the same change, and
  again for the tap. The `previous_times_used` rate reads from the tap onward.
- The `previous_dayparts` database function is untouched.
