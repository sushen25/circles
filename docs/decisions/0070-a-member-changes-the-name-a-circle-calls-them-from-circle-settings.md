---
adr: 70
title: "A member changes the name a circle calls them from circle settings, and the new name shows everywhere, plans already locked in included"
status: proposed
date: 2026-10-15
amends: [65]
builds_on: [60]
---
# ADR 0070: A member changes the name a circle calls them from circle settings, and the new name shows everywhere, plans already locked in included

_Status: proposed · 15 October 2026 · amends [ADR 0065](0065-co-members-see-the-circles-name-for-a-member-and-nothing-else.md) (a membership's name was set at joining and by nothing after), builds on [ADR 0060](0060-a-quiet-asks-initiator-is-not-inferable-from-member-data.md)_

## Context

[ADR 0065](0065-co-members-see-the-circles-name-for-a-member-and-nothing-else.md)
made the join screen's promise true: co-members see only the name a circle
gives a person, and an account rename touches no circle. It left one gap, named
in its consequences. The circle's name for somebody is set when they join or
rejoin and by nothing after, so a typo, or a name that no longer fits, can be
fixed only by leaving and rejoining. That loses the person's place in the
circle's plans and needs a live invite.

## Decision

1. **A member changes the name one circle calls them, from circle settings.**
   On the reader's own row, a quiet "Change my name here" opens the join
   screen's name field in a sheet, with the same sentence: "This is only what
   {circle} will call you. Your account keeps its own name."
2. **`public.rename_in_circle(circle, name)` writes the caller's own active
   row, and nothing else.** The row is found by `auth.uid()` and the circle;
   there is no parameter naming anybody else, so the owner cannot rename a
   member. A caller who is not active in the circle (never was, was removed, or
   the circle is unknown) gets one answer, `member_not_found`.
3. **The join path's rules.** The name goes through the same schema
   (`JoinDisplayName`, the domain's rule), the same length check
   (`circle_members_name_length`) and the same uniqueness among active members
   (`circle_members_active_name_idx`), answered as `duplicate_name`. Keeping
   your current name is not a collision.
4. **The new name shows everywhere at once, plans already locked in included.**
   Nothing stores a copy of a name: rosters, plan screens, confirmation
   screens and letters read `display_name_snapshot` when they are drawn. So a
   rename also changes what a locked-in plan shows next to the person. That is
   the default and it stays. A name on a plan that a person has just corrected
   is the person's wish, and a roster that showed two names for one person
   would be worse than either.
5. **Rate-limited, and nothing identifying recorded.** The `rename-in-circle`
   Edge Function allows 20 renames an hour to a person, hashed like every
   limit. No outbox event, no audit row and no analytics event is written: a
   name is not an analytics fact, and an audit row would copy it somewhere
   new.
6. **The Account screen points at it.** Its hint says where the circle's name
   is changed.

## Alternatives considered

- **Keep a locked-in plan's old name.** Needs a copy of the name on the plan,
  which is a second place for a name to leak from and to go stale, and shows
  two names for one person in one circle. Not taken.
- **Let the owner rename members.** Not asked for, and a name is the person's
  own. Not taken.
- **Emit a `member_renamed` event for analytics.** It would carry nothing
  useful without the name. Not taken.
- **Rename through a direct table update.** The column is not writable by a
  member, and the join rules and limit would be skipped. Not taken.

## Consequences

- Migration 0056 adds `rename_in_circle`. pgTAP `470_rename_in_circle.sql`
  proves a member renames themself, a duplicate is refused, nobody can rename
  another member and a removed member cannot rename.
- ADR 0065's third decision and its second consequence no longer hold: the
  per-circle name is now also set by a rename from settings, and leaving and
  rejoining is no longer the only way to change it.
- A member whose name is taken by a former, removed member can use it: the
  uniqueness is among active members.
