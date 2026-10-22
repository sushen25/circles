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
- **What happens to the guest's anonymous identity, contacts and consents** is
  what already happens on the other reattach paths, because the move is the
  same one (`private.move_membership`, `private.reconcile_contacts`). The
  anonymous `auth.users` row is not deleted or merged: it keeps whatever it
  holds outside this circle (a guest who is also in another circle stays that
  circle's member), and with no memberships left it is removed by retention
  after thirty days ([ADR 0014](0014-retention-runs-in-the-database.md)).
  This circle's email contacts and plan-update consents move to the account
  with the place, scoped as before to the plan they were given for; an address
  the account already holds is merged rather than duplicated, a withdrawal
  survives the merge, and a suppression stays global by hash. Contacts and
  consents held for other circles stay with the anonymous identity. Queued mail
  for this circle is re-pointed. Nothing becomes marketing consent
  ([ADR 0048](0048-the-consent-sentence-is-the-one-string-that-lives-in-config.md)).
  The guest's emailed re-entry links are retired, since the place is now a saved
  one. `pgTAP` 520 asserts the contact and the consent moving.
- **An account that once left the circle** can still take a guest's place. Its
  old, removed row is cleared to make room, as `claim_identity` does for the
  same person coming back (`private.discard_membership_rows`); only an active
  membership is `already_member`. The same account could already come back by
  "I'm new here" while a plan is asking, so this opens nothing new.
- **A residual case, accepted.** A guest who gave an address, then signs up with
  a different one and takes their place from the list, can have that place taken
  back to a guest session if they later open their *old* emailed link signed
  out: the link names an address the account does not hold (ADR 0049, decision
  6). The place is a guest's again and the account can pick it once more.
- **Analytics.** The client event is `member_reattached` with a third `source`,
  `list_account`, declared in the catalogue before it is emitted, so the
  funnel can tell an account's claim from a guest's pick. It carries the circle
  id and nothing about the person. The database's audit row and the owner's
  "rejoined from a new device" event keep `source: 'list'`; the founder's
  reattach gate counts product rows, not events
  ([ADR 0080](0080-the-reattach-and-verified-gates-count-product-rows-not-events.md)),
  so it is unaffected.
- **Idempotency and limits are the guest path's, unchanged.** A retry of a
  completed pick is served by the idempotency record, and the database answers
  a pick of one's own place with the circle and moves nothing. The per-address
  hourly limit in the Edge Function and the per-circle limit of twenty moves an
  hour in `public.reattach_member` apply to an account as to a guest; the
  second counts completed moves only, so somebody who is not a member cannot
  spend it.
- **A circle page is not a plan link.** `MembershipGate` still answers a
  non-member on a circle page (`/circles/...`, reached by navigating, with no
  code in the URL) with "ask for the invite link", for an account and a guest
  alike. The list is keyed by a plan's short code and the pick needs a live
  plan link; a non-member has no way to learn either from a circle page, so
  nothing is revealed there.
- The privacy invariant "a reattachment moves a membership only within a circle
  the guest already belongs to, never onto a saved-place member" is reworded to
  say what it protects: a reattachment never takes a saved-place member's place.
  It was always enforced on the place taken, not on the person taking it, except
  by the caller check this ADR removes.
- `caller_is_permanent` now comes only from the emailed link.
