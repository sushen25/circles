---
adr: 72
title: "The analytics ingest records only what a caller can know"
status: accepted
date: 2026-10-15
builds_on: [58]
---
# ADR 0072: The analytics ingest records only what a caller can know

_Status: accepted · 15 October 2026 · builds on the first-party ingest of architecture §15 and on [ADR 0058](0058-every-circle-carries-a-cohort-only-the-founder-can-see.md), whose cohorts the gates are counted in_

## Context

SUS-185. `track-events` takes a batch from anyone: a signed-in member, a guest, or
a script with the publishable key and no account. The founder's decision gates
(reattach, email verified, open to response) are counted from `analytics.events`,
so what the ingest will store decides what a script can move. Three gaps:

1. Every event in the catalogue was accepted from every caller, including ones
   whose meaning is a server-side fact (a cadence nudge sent, a delivery result,
   a threshold reached).
2. A `circle_id` or `plan_id` in a payload was written to its own column with no
   check that the caller belongs to it, so events could be filed against groups the
   caller has never seen, and the cohort of an event is its circle's.
3. The two quiet-ask events are meant to be recorded against nobody and to the
   hour, but only the client did that; the ingest stored what it was sent, and
   `received_at` to the millisecond.

What a caller could not do was already fixed: a `user_id` comes only from the
verified token, and a payload cannot carry words. This is integrity, not
confidentiality.

## Decision

- **Every catalogue event has a source.** `client` (the default) or `server`. The
  ingest refuses a `server` name from every caller and counts the refusal by event
  name only. The functions that own those facts keep recording them with the
  service role. Today that is `cadence_prompt_sent` (the dispatcher),
  `email_delivery_result` (the provider webhook), `quiet_threshold_reached`,
  `candidate_set_generated` and `plan_expired`. An event the app sends stays
  `client`, and a test reads the app's own `track()` calls to keep it so.
- **An id is kept only for a member.** One call per batch to
  `public.analytics_member_ids` (service role only) says which of the batch's
  circle and plan ids the caller is an active member of, a plan through its
  circle. The rest are nulled and the event is kept. Nobody signed in is a member
  of nothing, and no call is made.
- **Events recorded against nobody are stored that way by the ingest.**
  `UNATTRIBUTED_EVENTS` get no `user_id`, no `anonymous_id`, and `occurred_at` and
  `received_at` rounded down to the hour, whatever the caller sent.
  `record_events` takes an optional `received_at` per row for this.
- **`client_error` stays a client event and is bounded.** The app's error boundary
  sends it (SUS-112). The ingest counts a batch's crash reports against a limit
  per address (30 a minute) and drops the reports, not the batch, past it.

## Alternatives considered

- **Mark the four gate events (`member_reattached`, `email_verified`,
  `account_claimed`, `session_missing_on_return`) `server`.** The app sends all
  four, so refusing them would stop the measurement the gates are made from.
  They stay `client`. A forged one cannot reach a circle, and one with no user or
  circle is counted in no cohort. The gates are better computed from product
  tables (reattachments from `private.audit_log`, verifications from
  `private.email_contacts`), but `session_missing_on_return` has no product
  table behind it, and the views are being changed by other work; recorded as a
  follow-up instead.
- **Check membership per event.** One query per event on a batch of fifty, for
  nothing: the ids repeat.
- **Refuse the batch when an id is not the caller's.** A tab open on a circle the
  member has since left would lose every event in the batch. Nulling keeps the
  event and loses only the attribution.

## Consequences

- A script with no account can no longer create a server-source row or a row
  attributed to a circle; the gate views are unchanged and a test shows a forged
  batch moving neither cohort's reattach or verified gate.
- A signed-in member can still file their own events against their own circles.
  That is what the app does; the bound is the 600 events a minute per user.
- One more database call per batch that names a circle or a plan, none otherwise.
- A new catalogue event is `client` unless declared with `serverEvent()`; a server
  event added later is refused by the ingest with no further change.
- Migration 0067 adds `analytics_member_ids` and the optional `received_at` on
  `record_events`.
