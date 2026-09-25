# ADR 00XX: Keen members may take the organiser role as soon as a quiet ask opens

_Status: proposed · 26 September 2026_

## Context

Spec §5.4.5 describes an order: when a quiet ask meets its threshold, the
initiator is offered **I'll organise** or **Ask for a volunteer**, and "Ask for
a volunteer" is what gives every keen member a one-tap **I'll pick the time**.
Read literally, a keen member may not take the role until the initiator has
chosen to ask for a volunteer.

S2-02 (SUS-50, PR #88) built `accept-organiser` without that order: from the
moment the ask opens, any keen member — the initiator included — may take the
role, first writer wins, and the owner may once replies close. It left the
question open on the PR for the screens to settle.

The order cannot be kept without breaking the thing the feature protects. For
the server to hold keen members back until the initiator chooses, something
would have to record that the initiator chose — a state, an event, a timestamp
— and "the role opened to volunteers at 18:42" beside the one person who could
have opened it is the initiator with extra steps. Nor can a screen keep it:
`quiet-view` gives the initiator and a keen member the same `may_take_role`,
by design, so the screen cannot tell them apart to hold one of them back.

## Decision

**A keen member may take the role from the moment the ask opens.** The
initiator's "Ask for a volunteer" is a choice not to take it, not a gate that
opens it for others: it takes them back to circle home, where the ask reads
"Started quietly", and changes nothing on the server.

On screen (S2-03): every reader with `may_take_role` and no organiser yet sees
**Volunteer** ("I'll pick the time"). The initiator sees **ThresholdRole**
instead only when this device watched their own ask open — it had just shown
them SparkWaiting, whose `may_withdraw` is the same fact — held in memory for
the session, never stored or sent, and forgotten once they choose. The
initiator arriving any other way (the "enough people are keen" letter, a
reload) sees Volunteer, whose one tap works for them too.

## Alternatives considered

- **Hold keen members back until the initiator chooses.** Needs a recorded
  choice tied to the initiator, which is the leak; and leaves the ask with
  nobody able to organise for as long as the initiator does not look, when the
  ask has just proved people want to meet.
- **A timer: keen members may take it after an hour.** The same record, with a
  delay, and a rule nobody can explain on a screen.
- **Tell the client who the initiator is so it can always show ThresholdRole.**
  The one thing `quiet-view` exists not to do.

## Consequences

- Spec §5.4.5 is amended in this PR: **Ask for a volunteer** leaves the role
  to the keen, who can already take it; it is not what offers it to them.
- A keen member can take the role before the initiator has seen the ask open.
  The initiator then sees SparkOpenedMember ("Tom volunteered to pick the
  time"), like any other member, which is the outcome §5.4 wants: someone other
  than the initiator organises.
- `accept-organiser` stays as S2-02 built it. No server change.
