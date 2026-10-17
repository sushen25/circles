---
adr: 78
title: "A guest may continue as themselves as often as they need: no cap on how often a membership moves"
status: proposed
date: 2026-10-17
amends: [6, 49]
---
# ADR 0078: A guest may continue as themselves as often as they need: no cap on how often a membership moves

_Status: proposed · 17 October 2026 · amends [ADR 0006](0006-continue-as-reattachment-without-owner-approval.md) and [ADR 0049](0049-continue-as-resolves-a-code-only-while-it-is-live.md) (decision 4)_

## Context

[ADR 0006](0006-continue-as-reattachment-without-owner-approval.md) let a guest
with no session pick their name from the Continue-as list, with three
safeguards; one was "at most three reattachments per membership per seven
days". [ADR 0049](0049-continue-as-resolves-a-code-only-while-it-is-live.md)
narrowed it to moves made from the list, so a move made with an emailed link was
never counted or refused.

A real guest met the cap in the friends cohort. Losing a session is the normal
path, not the rare one (ADR 0006's own reason): every browser holds its own, so
opening the plan link from WhatsApp's in-app browser one day, Safari the next and
a laptop after that is three moves. The fourth showed "{name} has moved to a new
device three times this week, which is the most we allow. Ask the circle's owner
to help", and the owner had nothing to help with: the only remedy was removing
the membership, which deletes that person's answers. Most guests never ask for
plan-update email, so most have no link to get round it.

The founder decided on 17 October 2026: a guest may continue as themselves as
many times as they want.

## Decision

1. **No per-membership cap.** `private.reattach_member_core` no longer refuses a
   list move by count. `private.list_moves_this_week` is dropped (nothing else
   read it), and the `reattach_limit` refusal is removed from the contracts, the
   Edge Function's problem table and the app's copy.
2. **Everything else stays.** Only guest memberships can be moved, and never by
   a saved-place caller; the code resolves only while a plan is live (ADR 0049,
   0059); the per-circle limit (twenty list moves an hour, in SQL and in the
   Edge Function) and the per-address limit (ten an hour) still apply; every move
   writes its audit row with `source`, and the owner sees "X rejoined from a new
   device" on circle home and can remove a membership.

## Alternatives considered

- **Raise the cap** (say ten a week). Rejected: any number a real guest can hit
  ends in the same dead-end screen, and a number high enough never to bite real
  use protects nothing the hourly limits do not.
- **Count moves away from the guest's own earlier sessions only.** Rejected for
  the reason ADR 0049 gives: contacts and sessions are not proof of who someone
  is, so it counts the same moves under another name.
- **Keep the cap and give the owner a "reset" control.** Rejected for now: it
  puts the owner in the loop on the most ordinary path, which ADR 0006 chose not
  to do, and the refusal reaches the guest at the moment they are trying to
  answer.

## Consequences

- A guest who keeps losing their session is never refused for it.
- **What the cap was for is now bounded only by the hour and by visibility.**
  Inside a live plan's window, somebody holding the link can take a guest's place
  from the list again and again, up to the per-circle limit each hour, and the
  guest can take it back the same way. Each move tells the owner. In a private
  friend group this is the residual ADR 0006 accepted ("low-risk, visible, and
  reversible"); if it is ever abused, the answer is owner tooling or a
  confirmation step, not a weekly count.
- ADR 0049 decision 4's reasoning about which moves count is moot; its
  take-back rules (decision 6, `private.takeback_allowed`) still read `source`
  from the audit rows and are unchanged.
