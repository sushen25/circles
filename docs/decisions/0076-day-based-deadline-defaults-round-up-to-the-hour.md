---
adr: 76
title: "Day-based deadline defaults round up to the next whole hour"
status: proposed
date: 2026-10-15
builds_on: [10]
---
# ADR 0076: Day-based deadline defaults round up to the next whole hour

_Status: proposed · 15 October 2026 · builds on [ADR 0010](0010-tonight-deadline-gives-up-its-margin.md)_

## Context

Spec §5.3 defaults the response deadline to 24 hours (this weekend, next 7 days) or 72 hours (next 14 days) after creation. Taken to the minute, an organiser who creates a plan at 6:22 pm is shown "Replies close Mon 12 Oct, 6:22 pm". Nobody chose that minute, and a group chat does not read it as a promise.

## Decision

The 24-hour and 72-hour defaults, and the custom window's 24 hours, are rounded **up** to the next whole hour on the plan's own clock (its IANA zone, so a half-hour zone still lands on :00 local), then capped at the last possible start as before. A moment already on the hour stays. Tonight is unchanged: its hour is already a promise about the evening, and rounding would stretch it towards two. `defaultDeadline` takes the plan's zone.

It rounds up, never down, so the organiser is never given less time than the preset says. It does not pick a time of day such as 6 pm: that would move deadlines by hours and change behaviour, not tidy it.

## Alternatives considered

- **6 pm local.** Reads well, but a plan made at 7 pm would get nearly 47 hours, not 24. Rejected as a behaviour change.
- **Round in UTC.** Wrong for zones that are not whole hours from UTC.
- **Leave it.** The odd minute is what the usability review (SUS-204) found.

## Consequences

A default is up to 59 minutes longer than before. Spec §5.3 says so. Existing plans are untouched; only new defaults change.
