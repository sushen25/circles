---
adr: 59
title: "Continue-as resolves plan codes only, never a circle's own code"
status: proposed
date: 2026-10-09
amends: [49]
---
# ADR 0059: Continue-as resolves plan codes only, never a circle's own code

_Status: proposed · 9 October 2026 · amends [ADR 0049](0049-continue-as-resolves-a-code-only-while-it-is-live.md) decision 1 and its last consequence, and spec §5.1_

## Context

[ADR 0049](0049-continue-as-resolves-a-code-only-while-it-is-live.md) made a
plan's code a way back in only while the plan is live, and kept the circle's own
code resolving for as long as the circle is `active`, because the founder's
decision of 2 October 2026 named both and because "no product link carries it
today, so this affects a direct RPC caller only."

A member who has been removed is exactly that caller. The security review of 9
October 2026 found that the branch lets such a person retake a guest's place for
as long as the circle exists:

- Every member can read `circles.short_code` (`circles_select_member`). Nothing
  rotates it: resetting the invite link rotates the invite's secret, not the code.
- `guest_members_for_reattach(code)` lists each guest's user id and name, and
  `reattach_member(circle, guest)` is granted to `authenticated`. Neither can
  know the caller was removed, because a fresh anonymous sign-in is a new user id.
- So a removed member signs in anonymously, lists the guests with the code they
  noted while a member, and takes one guest's place: every plan, the roster, notes
  and places, and that guest's own answers. The real guest loses access; the owner
  sees only "rejoined from a new device". Nothing time-bounds it.

A second, smaller fact surfaced while closing this. The list path of
`reattach_member` takes a circle id and a member id, **not a code**, and checked
no code at all. A removed member who kept the two ids (a member can read both
while one) needed no code, circle's or plan's.

## Decision

**1. Continue-as resolves plan codes only.** `private.circles_open_to_continue_as`
loses its circle-code branch: a circle's own short code resolves to no circle, so
`guest_members_for_reattach` lists nobody for it and `preview_for_code` (which
reads the same rule, and only ever matched plans) is unchanged. Nothing the
product shares carries a circle code (`packages/contracts/src/deeplinks.ts` has
`/join#secret`, `/j/:plan` and `/p/:plan`), so no user-facing flow changes; the
founder's 2 October decision about the circle code is withdrawn by this record.

**2. The list path of `reattach_member` requires a live plan in the circle.**
`reattach_member` is given no code, so it asks the question a code would have
answered: does the circle have a plan whose link is still a way back in? The
rule is now one function, `private.plan_live_for_continue_as(plan_id)` (the
circle is `active`, and the plan is `collecting` or `ready`, or `confirmed` or
`completed` with a meetup that ended less than `private.continue_as_window()`
ago), read by `private.circles_open_to_continue_as` and by `reattach_member`.
A refusal is `member_not_found`, the answer for a membership that is not there.
The emailed link is unchanged: it proves an address, and does not depend on a
plan.

**3. What stays open, plainly.** A plan's code is shared in chats and logs by
design (ADR 0022), and it is still a way back in while its plan is live. A
removed member who noted a live plan's code, or who keeps hold of a locked-in
plan's link, can use it for as long as the plan is live, at most the plan's life
plus fourteen days after the meetup. That is the property ADR 0049 accepted for
plan codes ("admits for days, not for good"), now without the unbounded case
beside it. Closing it further is a different design (rotating a plan's code when
a member is removed, or the per-list opaque handle of ADR 0049 decision 5) and is
not made here.

## Alternatives considered

- **Rotate `circles.short_code` in `remove_member` and `issue_invite`**, and keep
  the branch. Rejected, because no reason to keep the branch was found: no
  product link carries the code, so a rotation would maintain a door that only a
  direct RPC caller can open. It would also close less. It rotates on two events
  and leaves the code open on every other path (a member who leaves, a member
  who is removed by a path that does not rotate), where removing the branch
  closes all of them.
- **Remove the branch and leave `reattach_member` as it was.** Rejected: a
  caller holding a circle id and a guest id would still need no code at all.
- **Bind the list to the caller** (a table of offers, or the opaque handle of ADR
  0049 decision 5). Larger, and not needed to close this finding; still open as
  recorded there.

## Consequences

- One migration (`0047`), function bodies only: `private.circles_open_to_continue_as`
  changes, `private.plan_live_for_continue_as` is new, `public.reattach_member`
  asks it on the list path. No table changes and no client change.
- A circle with no live plan offers no Continue-as list and refuses a list move,
  by id as well as by code. The way back for a guest there is the emailed link,
  or the circle's invite.
- ADR 0049's table row for a circle's code and its consequence that "the circle's
  own code is resolvable while the circle is active" are superseded by this
  record; spec §5.1 and the architecture's Continue-as paragraph say so.
- pgTAP `420_continue_as_plan_codes_only` covers a removed member on a fresh
  identity, the circle's code, a live plan, a cancelled plan and the emailed link.
