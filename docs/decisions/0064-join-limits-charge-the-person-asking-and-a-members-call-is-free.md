---
adr: 64
title: "Join limits charge the person asking, and a member's call is free"
status: proposed
date: 2026-10-10
amends: [22]
builds_on: [12]
---
# ADR 0064: Join limits charge the person asking, and a member's call is free

_Status: proposed · Date: 10 October 2026_

## Context

[ADR 0022](./0022-a-plan-link-admits-new-members-while-the-plan-is-asking.md) made a
plan's short code admit people, and said the join is "rate-limited per code and per
address". Spec §14 and the architecture said the same of an invite: limited per IP and
per circle. In the Edge Functions that became one counter per link, shared by everybody
holding the link, charged for every attempt including refused ones and including calls
by people already in the circle, plus a small counter per address.

Two things followed (SUS-113). Honest use reached the limits: a group of twenty opening
one link, a member's screen calling `join-plan` again, a retry after `duplicate_name`,
or friends on one carrier's address. And anyone holding the link could spend the shared
allowance with refused requests and keep everybody else out for the hour.

## Decision

A limit is spent by whoever makes the attempts, and by nobody else.

1. An active member of the circle a link opens costs nothing: their call is not counted.
2. Anyone else is counted three ways, each hourly: per link **and caller**, per caller
   across all links, and per address. There is no counter shared by every holder of a
   link. Admission itself is bounded by the member cap ([ADR 0012](./0012-circle-member-cap-of-twenty.md)).
3. The per-caller counter, small enough that a person trying codes meets it in a few
   dozen tries and large enough that nobody joining honestly does, is the brake on
   guessing. The per-address counter is sized for a household or a carrier's shared
   address, in the way the anonymous sign-in limit is (60 an hour); it stops one
   address minting identities to get fresh per-caller allowances.

The numbers (10, 30 and 120 an hour) live in `JOIN_LIMITS` in
`supabase/functions/_shared/rate.ts`, with the reasoning, and apply to `join-plan` and
`redeem-invite` alike. No SQL changes: `take_rate_token` is used as it is, with
different keys.

## Alternatives considered

- **Count successful admissions only.** `take_rate_token` has no way to read a count
  without charging, so it would need a new SQL function and migration, and a limit that
  is charged after the work cannot refuse it.
- **Keep the shared per-link counter and raise it.** Raising it only lengthens the time
  somebody needs to lock the others out.

## Consequences

- One person's junk requests cannot make `join-plan` or `redeem-invite` refuse a
  different person.
- A person on the same address as someone sending a hundred and twenty requests an hour
  can still be refused by the address counter. That limit is per address by design.
- Guessing codes is limited by the caller and address counters rather than by a shared
  per-code counter, which a guess at an unknown code never meaningfully used anyway.
- The two functions read one column to learn whether the caller is already a member. If
  that read fails the caller is charged as a stranger, so a failure tightens a limit.
