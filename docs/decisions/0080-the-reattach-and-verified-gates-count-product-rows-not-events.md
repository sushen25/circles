---
adr: 80
title: "The reattach and verified gates count product rows, not events"
status: accepted
date: 2026-10-19
builds_on: [58, 72]
---
# ADR 0080: The reattach and verified gates count product rows, not events

_Status: accepted · 19 October 2026 · builds on [ADR 0072](0072-the-analytics-ingest-records-only-what-a-caller-can-know.md), which left this as a follow-up, and on [ADR 0058](0058-every-circle-carries-a-cohort-only-the-founder-can-see.md), whose cohorts the gates are counted in_

## Context

The ingest cannot tell a real `member_reattached` or `email_verified` from one a
signed-in member sends by hand: both come from the app, and ADR 0072 left them
`client`. It bounded the damage (an id is kept only for a circle the sender is
in; 600 events a minute) but a member could still raise their own circle's
reattach and verified gates. Both facts are already written to tables by the
functions that own them.

## Decision

- **The reattach gate's numerator is `private.audit_log`.** One
  `circles.member_reattached` row with `source = 'list'` is one completed
  reattachment, written after the move succeeded, counted in its circle's cohort
  on the day it happened. Reattachments from an emailed link stay in neither half,
  as before.
- **The verified gate's numerator is `private.email_contacts` and the audit log.**
  A guest who submitted an address counts as verified when they have a contact
  with `verified_at` at or after the submission, or a recorded claim
  (`growth.account_claimed`, `circles.member_claimed`: signing in is the other
  route the gate has always counted). A proof counts from five minutes before the
  submission's client-reported time, so a fast clock does not lose it.
- **The denominators stay client events** and are bounded: `session_missing_on_return`
  has no product table (a session that is missing leaves no row), and
  `email_submitted` is the guest's act before any contact is verified. A forged
  denominator can only dilute a rate, never raise it.
- The views keep their columns, so `founder_analytics`, its cohort split and the
  source split of SUS-171 are unchanged. Migration 0068.

## Alternatives considered

- **Leave the numerators as events and tighten the ingest further.** A signed-in
  member's own events are indistinguishable from the app's; no ingest rule closes it.
- **Derive the denominators from tables too.** Nothing records a session that failed
  to restore, and a contact exists for reasons other than a save-your-place prompt.

## Consequences

- A forged `member_reattached`, `email_verified` or `account_claimed` event moves
  neither gate; a pgTAP test shows it, and shows a real reattachment and verification do.
- **The verified numerator decays.** `verified_at` is cleared by an unsubscribe,
  a bounce or a complaint, and retention deletes a finished plan's contact after
  30 days, so an older verification drops out while its `email_submitted` stays.
  The gate reads low over the longer periods, never high. A durable verification
  row is the follow-up if the founder needs those periods exact.
- The audit log is kept 12 months, so a window beyond that loses reattach
  numerators. `gate_claim_moments` and `reattach_rate` (`founder_summary`) still
  read client events and are outside this change.
- The events are still recorded and still appear in the event counts.
