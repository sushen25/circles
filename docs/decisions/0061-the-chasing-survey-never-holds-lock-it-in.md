---
adr: 61
title: "The chasing survey never holds Lock it in: an unanswered question is stored as not answered and counted on its own"
status: proposed
date: 2026-10-09
builds_on: [58]
---
# ADR 0061: The chasing survey never holds Lock it in: an unanswered question is stored as not answered and counted on its own

_Status: proposed · 9 October 2026 · changes spec §5.10 (the organiser micro-survey) and §11.4 (the "answered without being chased" gate)_

## Context

The review screen asks the organiser "Did you have to chase anyone outside the
app?" (spec §5.10), the evidence for hypothesis H2. It was required: **Lock it
in** stayed disabled until the organiser answered, and the endpoint and both
database functions refused a confirmation without it. A research question was
holding the one decision the product exists to produce, with a disabled primary
button and no reason given (the usability review of 9 October 2026, finding H2;
manifesto §3.6, one decision per screen).

The founder chose, on 9 October 2026, to keep the question on the review screen
and make it optional (SUS-194).

## Decision

- "Lock it in" is enabled whenever the fields are valid. The question stays on
  the review screen, marked optional.
- An unanswered question is stored as **not answered**: `meetup_confirmations.chased_answer`
  is null (the column was always nullable). On the wire, `confirm-meetup` accepts
  an omitted `chased_answer`; the functions `confirm_meetup` and `confirm_own_time`
  accept null. A value that is not `none`, `one` or `more` is still refused.
- No `organiser_chased` event is recorded for an unanswered question.
- The "answered without being chased" gate (spec §11.4) counts only answered
  confirmations in both halves of its share. Unanswered confirmations are
  reported beside it as `unanswered`, a count of confirmations, never read as
  "no" and never in the denominator, because nobody said how many were chased.
  The founder's analytics screen shows that count under the gate.

## Alternatives considered

- **Ask it after, on the confirmed screen, as a skippable row.** The other
  option the review offered. Not chosen: more screen and a second moment to
  answer, where the review already has the organiser's attention.
- **A fourth stored value (`unknown`).** Not chosen: it needs a constraint
  change and says the same thing as null, which every existing read already
  treats as "not answered".
- **Count unanswered in the denominator.** Not chosen: it would read as "chased
  everyone" and push the H2 share down by the organisers who simply skipped.

## Consequences

- H2's evidence will have gaps. The gate's `n` falls by the organisers who
  skip, and the unanswered count says by how many, so the founder can judge
  whether the share still rests on enough answers (the gate's own minimum still
  applies).
- Migration 0049 changes `analytics.gate_unchased` (a new last column), the two
  confirm functions and `founder_analytics()`.
