# ADR 0038: The quiet ask's initiator is written to at their own address

_Status: accepted · 25 September 2026_

## Context

S2-02 (SUS-50) builds the quiet ask's backend. Spec §5.8 lists its messages as
**push only**: the prompt to everyone but the initiator, and at the threshold
one message to the initiator ("do you want to pick the time?") and one to the
keen members ("choose your times"). §5.4.7 adds a closing notice — "Not enough
people were free this time" (the SparkExpired artboard) — without a channel.
`copy.ts` and `render.test.ts` held a rule to match: no kind in
`QUIET_SENSITIVE_KINDS` is ever emailed.

Slice 2 is web-only, and Slice 1 sends no push at all (SUS-59 adds it in
Slice 3). So as specified, the only person who needs to act when an ask opens —
its initiator, who is offered the organiser role — is told nothing unless they
happen to open circle home; and the closing notice has no way to reach them.
The ticket asked for both by email, and SUS-49 agreed that the closing notice
was right.

The reason the rule existed is sound and survives: a letter about a quiet ask
that reaches anybody but its initiator, or names anybody, or carries a count,
is the leak the feature exists to prevent.

## Decision

The initiator receives **two letters about their own ask, at their own
confirmed address**, until they install the app:

- **`threshold_initiator`** gains email as its second channel, exactly as the
  organiser kinds have (review C6): push when they have a device, else email.
  "Enough people are keen … That can be you, or you can ask for a volunteer",
  linking the plan.
- **`quiet_expired`**, a new kind, email only: an ask that reached its stop
  time *without opening* ("Not enough people were free this time. This one
  closed quietly."), linking circle home. Not for a withdrawn ask — its
  initiator closed it themselves and spec §9 says nobody is told — and not for
  a quiet plan that opened and later ran past its last start.

Both are addressed to the person's auth address through
`dispatch_organiser_contact` (ADR 0027), so bounces suppress them like any
other letter; neither needs a subscription, since neither is a plan-update
letter and the reader asked for it by asking. Both are in
`QUIET_SENSITIVE_KINDS`, so muting quiet asks stops them. Neither names anybody
or carries a count, and render tests hold them to that. `quiet_ask` and
`threshold_keen`, which reach other members, stay push-only: **nobody but the
initiator is ever emailed about a quiet ask before it opens.**

The initiator is left out of `threshold_keen`: they are keen, and they have a
message of their own for the same moment.

## Alternatives considered

- **Push only, as §5.8 has it.** Correct for Slice 3 and silent until then:
  every quiet ask in Slice 2 would open to an initiator who does not know, and
  the owner's fallback nudge at the deadline would be the first anybody heard.
- **Email the keen members too.** They have no address of ours unless they
  subscribed to a plan, and a subscription is to *one* plan and never to a
  quiet ask still asking (§8.2). Asking for one would be a sign-up screen in
  the middle of "I'm keen", and the letter would tell their inbox that a quiet
  ask was going on.
- **A digest to the initiator.** Two letters in the life of an ask are not
  enough to digest.

## Consequences

- Spec §5.8 has a paragraph for the initiator's two letters; `kinds.ts` has
  `quiet_expired` and `threshold_initiator` has email; `notification_jobs_kind`
  allows `quiet_expired` (0026); `copy.ts`'s rule now reads "nobody but the
  initiator".
- A job row for either letter names the initiator's contact, which is the
  recipient — and so is theirs. Nothing else carries it: not an event payload,
  not a log line (a unit test reads every `log(` call in the functions), not
  another job. The dispatcher reads the initiator and the keen members only
  for the four quiet kinds, through `dispatch_quiet_audience`, never through
  the context every plan's drain loads.
- The provider sees the letter, as it sees every letter. Its subject names the
  circle and says nothing about who asked.
- When push lands (SUS-59), an initiator with a device gets the threshold
  message by push and not by email, as an organiser does; the closing notice
  stays email, because there is no push row for it on the artboard.
