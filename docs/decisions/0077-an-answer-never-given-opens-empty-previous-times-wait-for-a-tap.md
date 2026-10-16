---
adr: 77
title: "An answer never given opens empty: previous times are not applied on open, they wait for a tap"
status: proposed
date: 2026-10-16
amends: [37, 68]
builds_on: [5]
---
# ADR 0077: An answer never given opens empty: previous times are not applied on open, they wait for a tap

_Status: proposed · 16 October 2026 · amends [ADR 0068](0068-a-tapped-day-has-a-time-and-the-answer-is-one-line.md) and [ADR 0037](0037-usual-times-are-read-not-written.md) (previous times are no longer applied when the editor opens); builds on [ADR 0005](0005-willing-windows-retained-12-months.md)_

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
(`usePreviousTimes`, the `usual_times` function of ADR 0037) and the editor's
`usual` action stay in the code, tested, and nothing calls them on open. The
founder has decided they come back later as a button the person presses
("Use my usual days"); that is a separate ticket, designed on the canvas first.
Until it lands no screen reads them, and the first screen makes no request for them.

**The measurement stays truthful.** `availability_started.usual_offered` is sent
as `false` on every opening, because nothing is offered, and `usual_used` is
`false` on every send, because no answer begins from them. The fields stay in
the catalogue, unchanged and at version 1, for the follow-up and for the history
already stored; the `previous_times_used` rate reads as empty from this change
until then. The start no longer waits for the read, so it is sent as the editor
opens.

## Alternatives considered

- **Retire the two fields.** Rejected: the follow-up reuses them, and a retired
  field would have to come back at a new version.
- **Delete the read and the `usual` action.** Rejected: the founder wants the
  explicit tap, and rebuilding the read costs more than keeping a tested unit.
- **Keep the prefill but ask first.** That is the button of ADR 0037, which ADR
  0068 removed because the first screen carried too much; the follow-up decides
  whether it returns, on the canvas.

## Consequences

- The first screen is the same for a first-time and a returning guest.
- `usePreviousTimes` has no caller in the app until the follow-up; its tests keep
  it reachable. `useStartedEvent` stays in the same file and is used.
- Spec §5.5's "Previous times" paragraph is rewritten in the same change.
- The `usual_times` database function is untouched.
