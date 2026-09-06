# ADR 0005: Retain willing windows for 12 months for members of active circles

_Status: accepted · Date: 6 September 2026_

## Context
Spec v1 deleted willing windows 30 days after a plan ended, but the moats research (§6.4) and the spec's own "plan another" defaults rely on remembering how members respond. Willing windows are the least sensitive data in the system: they are the explicit, already-shared-in-aggregate answer, not calendar content.

## Decision
Keep willing windows for 12 months for members of active circles, and derive a coarse per-member, per-circle "usual day-parts" summary (weekday evenings, weekend afternoons, and so on) that survives deletion of raw windows. The summary is used only to pre-fill that member's own next response, never to score a member who has not answered. Windows of removed members and archived circles are deleted after 30 days.

## Alternatives considered
- **30 days (v1)** — too short for monthly cadence; discards the only learnable signal.
- **Indefinite** — unnecessary; the summary carries the useful part.

## Consequences
- The retention cron job has two rules instead of one.
- The privacy page states the 12-month retention in plain words.
