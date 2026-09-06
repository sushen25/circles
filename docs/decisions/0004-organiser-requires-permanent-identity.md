# ADR 0004: Organising a plan requires a saved place (permanent identity); responding never does

_Status: accepted · Date: 6 September 2026_

## Context
Spec v1 let any member, including anonymous web guests, initiate plans. The review found that Safari deletes script-writable storage after seven idle days and that chat in-app browsers isolate storage, so an anonymous organiser losing their session would strand the plan (nobody could confirm). At the same time, the manifesto forbids any account prompt before a guest's answer.

## Decision
Creating a circle, starting a named plan or quiet ask, and accepting the organiser role require a permanent identity (Apple, Google or email code). The gate appears only at that moment, links the existing guest membership, and is worded as a practical need. Responding, viewing candidates, confirming attendance and receiving plan-update email never require it.

## Alternatives considered
- **Allow anonymous organisers** — simpler, but a lost session strands a plan at its most important moment.
- **Require accounts for everyone** — kills whole-group activation (H2).

## Consequences
- RLS uses restrictive policies on `is_anonymous` for plan and circle creation.
- The "save your place" conversion has a natural, honest trigger.
- The quiet-ask volunteer path (`accept-organiser`) must prompt a guest to save their place before accepting.
