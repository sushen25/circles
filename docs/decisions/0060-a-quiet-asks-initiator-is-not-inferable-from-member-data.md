---
adr: 60
title: "A quiet ask's initiator is not inferable from member data: who has saved a place and who has muted are each member's own"
status: proposed
date: 2026-10-09
amends: [56]
builds_on: [32]
---
# ADR 0060: A quiet ask's initiator is not inferable from member data: who has saved a place and who has muted are each member's own

_Status: proposed · 9 October 2026 · amends [ADR 0056](0056-members-can-see-who-has-saved-a-place.md) (a member no longer reads another's saved-place state), and spec §5.4, §8.2 and architecture §8.4_

## Context

"Quiet-ask initiator identity … never exposed" is a structural invariant (spec
§8.2). It was not true of the data. Starting a quiet ask takes a saved place,
and is refused to somebody who has muted quiet asks. Two things a co-member
could read together named who could have started one:

- `member_profiles.has_saved_place` (ADR 0056) gave every member the saved-place
  state of every other.
- `circle_members` was selectable in full by co-members, so every member's
  `muted_quiet_asks`, `muted_all` and `muted_nudges` were readable too (SUS-115),
  and so were the rows of members who had been removed, with their names
  (SUS-184 overlaps here).

In a new circle where only the owner needed a saved place to make it, "has a
saved place and has not muted" is one person. The spec accepts that people may
still guess in small groups (§5.4); it did not accept a readable column that
makes the answer certain.

## Decision

Option 1 of SUS-181, **self-only data**: no table, view or function a member can
call returns another member's saved-place state or mute flags. The founder's
question on the progress dashboard defaulted to this option, the one the ticket
recommends.

1. **`member_profiles` is a name and an id again.** `has_saved_place` is dropped.
2. **`circle_members` is read for the caller's own row alone.** The select policy
   is `user_id = auth.uid()` for an active member; the table-wide `select` grant
   is revoked and a column grant covers the columns that one row is read for. A
   member keeps their own mute switches, and a removed member's row is
   selectable by nobody (including that member). Updating one's own switches is
   unchanged. This closes SUS-115 and the readable removed-member history.
3. **A roster view replaces the client's table select.** `public.circle_roster`
   (definer, filtered to circles the caller is an active member of) holds
   `circle_id`, `user_id`, `display_name_snapshot`, `role` and `joined_at` for
   active members: roster columns only.
4. **The "who has saved a place" roster is the owner's.**
   `public.circle_saved_places(circle)` returns every active member's flag to the
   circle's owner and the caller's own row to any other active member, so Circle
   settings still reads "You · guest" or "You · place saved" for the reader and,
   for the owner, the tier beside each name as ADR 0056 promised. Everybody
   else's row reads "Joined 3 Sep".
5. **`hand_off_candidates` tells the owner only.** The flag is null for an
   organiser who is not the owner; the hand-off sheet then offers everybody and
   the hand-off itself still refuses a guest.
6. **Names for ids on a plan screen come from `public.plan_roster(plan)`.** A plan
   screen names its people, including a required member who has since left (so
   the organiser can take them off, spec §9). The function returns the circle's
   active members and a removed member only where the plan's current revision
   still requires or asks them; it answers an active member of the plan's circle
   alone. It carries no mute flag and no saved-place state.

## Alternatives considered

- **A rule: refuse a quiet ask below N eligible initiators.** It keeps the
  columns readable and only makes the guess less certain; it says to the
  initiator, in effect, that the circle is too small to be private. Data nobody
  needs to read is better removed than hidden by a threshold. The spec would also
  have had to name N.
- **Column-level revoke of the mute flags alone.** It would leave the removed
  rows and the saved-place state readable and would keep the table the roster
  read, so the next column added would be readable by default.
- **Keep the saved-place tier on every row.** It was the founder's wish on 6
  October for Circle settings; it is what made the inference possible, so it is
  now the owner's.

## Consequences

- A non-owner member no longer sees "Guest" or "Place saved" on another member's
  row. The spec's Circle settings line is corrected in the same change.
- The owner can see who has saved a place, and so who could start a quiet ask.
  The owner is a saved-place member who chose the circle's members, and the
  nudge for an ask nobody opens is theirs (spec §5.4). A circle owner narrowing
  the initiators is accepted; no other member can.
- **What remains.** An organiser who is not the owner can still try to hand a
  plan to a guest, and the refusal names the reason. That tells one person one
  fact at a time, at the cost of an attempt and of a hand-off request that the
  server records; it is not a readable column. SUS-184's other halves are not
  part of this decision: the account name no longer being what `member_profiles`
  shows, and a rename overwriting every circle's snapshot.
- Guessing from behaviour (who is suddenly keen) remains out of scope and
  accepted, as before.
- The pgTAP file `430_quiet_ask_initiator_hidden.sql` replaces
  `360_member_saved_place.sql`, and pins the column lists of `member_profiles`
  and `circle_roster`: a column added to either is a decision again.
