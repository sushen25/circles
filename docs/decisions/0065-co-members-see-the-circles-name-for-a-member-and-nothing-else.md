---
adr: 65
title: "Co-members see the circle's name for a member and nothing else of their name: no view of account names, and a rename leaves every circle alone"
status: proposed
date: 2026-10-11
amends: [32]
builds_on: [60]
---
# ADR 0065: Co-members see the circle's name for a member and nothing else of their name: no view of account names, and a rename leaves every circle alone

_Status: proposed · 11 October 2026 · amends [ADR 0032](0032-the-circles-zone-is-shown-when-the-readers-device-differs.md) (the name-and-id view it kept is gone), builds on [ADR 0060](0060-a-quiet-asks-initiator-is-not-inferable-from-member-data.md)_

## Context

The join screen says "This is only what {circle} will call you. Your account
keeps its own name." The database did two things that contradicted it:

- `public.member_profiles` returned `profiles.display_name`, the account name,
  to everybody who shares an active circle.
- The trigger function `sync_member_names` overwrote every active membership's
  `display_name_snapshot` whenever the account name changed. The name a circle
  knew somebody by was therefore neither private to that circle nor stable.

A third finding, that a member could list removed members and when they were
removed, was closed by [ADR 0060](0060-a-quiet-asks-initiator-is-not-inferable-from-member-data.md)
(SUS-181): `circle_members` is readable for the caller's own active row only,
and the roster is the definer view `circle_roster`.

The founder's question on the progress dashboard offered the two ways to make
the promise and the database agree. The default, taken here, was to make the
database match the promise.

## Decision

1. **Co-members read the circle's name for a person and no other name.** The
   roster, `circle_roster`, `plan_roster` and `hand_off_candidates` already
   return `display_name_snapshot`. Nothing returns `profiles.display_name` to
   anybody but its owner.
2. **`member_profiles` is dropped.** Nothing in the client or the functions read
   it, and a view of only an id says nothing. A new view of account names would
   have to be a new decision.
3. **A rename touches `profiles` and nothing else.** The trigger and
   `sync_member_names` are dropped. A membership's name is set when somebody joins
   or rejoins the circle and by nothing after that.
4. **The uniqueness rule still holds without the trigger.**
   `circle_members_active_name_idx` covers the only name a co-member sees, so a
   rename cannot put two people in one circle under one name.
5. **The Account screen says so.** The name field is "Your account name", with
   "Only you see this. Each circle shows the name you gave it there."

An account name is still the default for a circle the person creates and for a
join from a plan link that supplies no name. That is a default at the moment of
joining, not a link.

## Alternatives considered

- **Change the join copy to say the account name is shown everywhere.** Honest
  and smaller, and it keeps rename in step. It makes the name a person gave a
  circle a thing they cannot choose per group, and it leaves an account name
  readable by anyone who shares a circle with them. Not taken.
- **Keep the overwrite but make it opt-in per circle.** Needs a setting per
  membership and a screen for it. Left as a follow-up if renames in circles
  are wanted; the dashboard question defaulted to leaving circles untouched.
- **Keep `member_profiles` as an id-only view.** Empty of purpose; dropped.

## Consequences

- Migration 0051 drops the view, the trigger and the function. Existing rows
  are untouched: circles keep the names they have.
- Until a per-circle rename exists, the only way to change the name a circle
  knows somebody by is to leave and rejoin it. A follow-up ticket owns that.
- A person who renames their account is not renamed in the circles they have
  already joined, owned circles included.
- pgTAP `450_circle_name_only.sql` proves a co-member cannot read an account
  name, a removed member's row or the time of a removal; that the per-circle
  name survives a rename; and that a member still reads their own account name.
  A unit test, `apps/app/src/copy/circle-name.test.ts`, holds the join screen's
  sentence against the generated columns of `circle_roster`.
