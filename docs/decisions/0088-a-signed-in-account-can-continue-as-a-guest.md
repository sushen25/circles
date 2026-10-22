---
adr: 88
title: "A signed-in account can continue as a guest, the same as a guest can"
status: accepted
date: 2026-10-22
amends: [6, 22]
---
# ADR 0088: A signed-in account can continue as a guest, the same as a guest can

_Status: accepted · 22 October 2026 · amends [ADR 0006](0006-continue-as-reattachment-without-owner-approval.md) and [ADR 0022](0022-a-plan-link-admits-new-members-while-the-plan-is-asking.md) (decision 3)_

## Context

[ADR 0006](0006-continue-as-reattachment-without-owner-approval.md) let a guest
with no session pick their name from the Continue-as list and take their place
back in one tap. It also said a saved-place identity never reattaches: it signs
in. [ADR 0022](0022-a-plan-link-admits-new-members-while-the-plan-is-asking.md)
built the plan link on that. Somebody signed in who is not a member of the
circle gets one tap, **Join [circle] as [name]**, and never a list of names.
`private.reattach_member_core` refused any signed-in caller with
`caller_is_permanent`.

That left the person it was meant to help with no way to their own place. Alex
answers a plan as a guest on their phone, then opens the same link on a laptop
where they are signed in. They cannot pick "Alex": the list is hidden from them.
**Join as** makes a second membership while the plan is asking (two Alexes, the
first one's answers left behind), and once the plan is not asking it is refused,
which ends at "You need the invite link to join". A guest on the same link at the
same moment could still pick their name. The account holder was the one person
shut out.

The founder decided on 22 October 2026: an account can pick any guest name, with
the same trust as a guest has today. No extra proof.

## Decision

1. **The Continue-as list is shown to a signed-in account too.** A signed-in
   person who is not a member of the circle, on a live plan link, sees the
   circle's guest members by display name and can pick one. **I'm new here**
   then offers the one-tap **Join [circle] as [name]** from ADR 0022, and when
   the circle has no guests to list they go straight to it, as before. **I have
   an account** is not shown, because they are signed in.
2. **A pick moves the guest's membership onto the account.** Everything the
   membership owns moves with it, as for a guest (`private.move_membership`):
   the place, its answers, its name in this circle. The account's own profile
   name is not touched, because what a circle calls a member is the circle's
   ([ADR 0065](0065-co-members-see-the-circles-name-for-a-member-and-nothing-else.md)).
   The membership is now a saved place, so its outstanding emailed re-entry
   links are retired (`private.retire_reentry_links`), as when a guest saves
   their place. The quiet-ask answer does not move with a list pick
   ([ADR 0062](0062-a-continue-as-pick-does-not-carry-the-quiet-ask-answer.md)).
3. **Everything else that bounds a list pick still applies.** Only a guest
   membership can be picked (never a saved-place member's), the plan link must
   be live ([ADR 0049](0049-continue-as-resolves-a-code-only-while-it-is-live.md),
   [ADR 0059](0059-continue-as-resolves-plan-codes-only.md)), an account already
   in the circle is told `already_member`, the per-circle and per-address
   hourly limits apply, the audit row is written with `source: 'list'`, and the
   owner sees "X rejoined from a new device".
4. **The emailed re-entry link is unchanged.** A signed-in account still cannot
   use somebody else's emailed link (`caller_is_permanent`). The link proves an
   address and is the rightful member's own way back, so it stays theirs.

## Alternatives considered

- **Ask for more proof when an account claims a place**, such as the guest's
  own device session or the emailed link. Rejected by the founder: most guests
  never give an address, so most could not prove anything, and the person this
  is for is the guest themselves on another device. The same trust as ADR 0006,
  low-risk, visible and reversible inside a private friend group.
- **Show the list, but make the pick a new guest session** rather than a move
  onto the account. Rejected: the person would have to sign out of their account
  to be themselves, and their place would stay a guest's that anybody could pick
  again.
- **Leave it.** Rejected: it shuts out exactly the person a guest becomes when
  they sign up, at the moment they come back.

## Consequences

- A guest who later signs in can take their own place from any device, whether
  or not the plan is still asking, as long as its link is live.
- **A place taken by an account cannot be taken back from the list.** Once the
  membership is an account's, the list no longer names it, so the residual risk
  ADR 0006 and ADR 0078 accepted is now one-way. Somebody signed in who picks
  another person's name keeps that place until the owner removes the membership,
  or until the guest uses an emailed link from that circle, which may take the
  place back from a saved account whose own address is not the link's (ADR 0049,
  decision 6). Each pick still tells the owner.
- The guest's old anonymous identity keeps whatever it held outside this
  circle, and its email contacts, as with any list pick. With no memberships
  left it is deleted after thirty days ([ADR 0014](0014-retention-runs-in-the-database.md)).
- The privacy invariant "a reattachment moves a membership only within a circle
  the guest already belongs to, never onto a saved-place member" is reworded to
  say what it protects: a reattachment never takes a saved-place member's place.
  It was always enforced on the place taken, not on the person taking it, except
  by the caller check this ADR removes.
- `caller_is_permanent` now comes only from the emailed link.
