---
adr: 56
title: "A circle's members can see which of them has saved a place"
status: proposed
date: 2026-10-06
builds_on: [32]
---
# ADR 0056: A circle's members can see which of them has saved a place

_Status: proposed · 6 October 2026 · builds on [ADR 0032](0032-the-circles-zone-is-shown-when-the-readers-device-differs.md), which kept `member_profiles` to a name and an id_

## Context

The founder asked that Circle settings say who is a guest and who has saved their
place. The fact is `profiles.is_permanent`, readable by its owner alone. The one
place it already crosses to another member is `hand_off_candidates`, which shows
the organiser "Needs a saved place". ADR 0032 said a third column on
`member_profiles` is a decision, not a tidy-up. This is that decision.

## Decision

`public.member_profiles` gains `has_saved_place` (`profiles.is_permanent`). The
view keeps its filter: people the caller shares an **active** circle with. A
non-member, and a member who has been removed, read no row. Every member who can
open Settings sees it on every row (the founder, 6 October 2026), as words and
nothing else: no colour, no icon, and not the dashed outline, which means
"hasn't answered".

## Alternatives considered

- **A column on `circle_members` kept by the trigger.** It would need a second
  write path on every upgrade, would be copied into history rows, and would be
  readable through the roster's existing policy by anybody the roster is open
  to. The view derives it at read time, so it cannot go stale.
- **A definer function.** Settings would call it per read; the view is already
  the place where a column limit is written, and the client reads it through RLS.

## Consequences

- Nothing else of `profiles` is exposed: not `is_permanent` under its own name,
  not the time zone, not the install date. The pgTAP column test now names three
  columns, so a fourth is a decision again.
- A guest sees that other members are guests. That was already inferable from
  the hand-off sheet; it is no longer limited to the organiser.
