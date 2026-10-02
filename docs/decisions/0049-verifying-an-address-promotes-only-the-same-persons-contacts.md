# ADR 0049: Verifying an address promotes only the contacts that belong to the same person

_Status: proposed · 2 October 2026 · amends the last consequence of [ADR 0027](0027-the-organisers-auth-address-is-an-email-contact.md); builds on [ADR 0019](0019-consent-is-recorded-when-it-is-given.md) and [ADR 0020](0020-the-verification-token-is-minted-by-the-sender.md)_

## Context

`verify_email_contact` used to mark **every** pending contact at an address
`verified`, whoever held it. The reason was good: uniqueness is
`(email_hash, user_id)`, and `private.reconcile_contacts` splits one person's
contact in two when their memberships are divided, so verifying only the contact
the link named could leave that person's own sibling pending for retention to
delete, with its consent, after seven days.

But the `where` clause had no notion of "the same person", so a pending contact
that another identity had recorded at that address was promoted too, and
`private.email_recipients_for` treats a verified contact with an active
subscription as deliverable. Verifying an address is evidence that **the person
who held the link** controls it. It is not evidence about anybody else's
consent to a plan. The invariant that "plan-update email consent is scoped to
one plan" (AGENTS.md) and spec §9's "mistyped: nothing activates" both need the
promotion to stop at the person.

The founder decided on 2 October 2026: **verifying an address promotes only
pending contacts that belong to the same `user_id`, or to an identity linked to
it by a recorded claim or reattachment.** Another identity's pending contact at
the same address is not promoted; it stays `pending` and retention removes it as
it does today.

## Decision

**1. One rule for "the same person", in one function.**
`private.same_person_identities(user_id)` returns the identity itself and every
identity connected to it by the `circles.member_reattached` and
`circles.member_claimed` rows of **one circle**, in either direction (each row records `from_user_id`, `to_user_id` and
the circle by id, written in the same transaction as the move). A membership
moved twice, A to B and then B to C, is one chain, so A, B and C are one person
for this purpose: the contact copied to C, with the verification link still on
A, is two moves away. The walk follows **one membership**, not an identity: two
rows join only where the move to an identity is followed, as the next recorded
event that touches it in that circle, by a move from it; an owner's removal
(`circles.member_removed`) in between ends the chain. An identity that passes a
place on and later takes somebody else's place in the same circle does not make
those two people one. Rows are ordered by `occurred_at`; one `reattach_member`
call is one transaction, so two moves never tie. The walk never crosses circles. Nothing else makes two
identities one person: not the same address, the same device or the same time.

**2. `verify_email_contact` uses it three times,** where it used the address
alone: the pending contacts it promotes; the subscriptions to finished plans it
withdraws; and the contacts it queues the current "locked in" letter for. All
three act on `private.email_contacts` rows whose `user_id` is in the set. A
contact held by anybody else is neither promoted, nor have its subscriptions
withdrawn, nor is it sent anything on this verification.

**3. How each case ends.**

| Case | Result |
|---|---|
| The contact the link named, held by the person who clicked | verified |
| A second contact of the same `user_id` at that address | verified (it cannot be split by identity: same row key) |
| A sibling left by `reconcile_contacts` on the identity a membership moved from, or the copy on an identity it moved to, however many moves along, connected by `member_reattached` rows of that circle | verified |
| Another identity's pending contact at the address, with no recorded link | stays `pending`, its subscription undeliverable; retention removes both after seven days |
| The copy that followed a membership to a new session and then to a saved place by a claim | verified (the claim is a recorded link) |
| The organiser's auth address (`dispatch_organiser_contact`) | unchanged: it already promoted only that user's own contact, so a different identity's pending contact at the same address is never touched |

**4. A claim is now a recorded link.** `claim_identity` wrote one audit row,
`growth.account_claimed`, which names the destination and not the anonymous
identity it came from, so there was nothing to walk. A claim does leave one
person on both ends: `reconcile_contacts` splits a contact whose identity keeps
another circle's consent, and the verification link stays on the guest while
the copy goes to the saved place (found in review: a reattached session that
then saved its place was left pending). So `claim_identity` now writes one
`circles.member_claimed` row per circle it moves or merges, with `from_user_id`,
`to_user_id` and the circle, in the same transaction, and the walk reads those
rows with `member_reattached`'s. Nothing earlier is rewritten or guessed: a claim
made before this migration has no row and is not linked.

## Alternatives considered

- **Same `user_id` only, with `reconcile_contacts` carrying the verified state
  across when it splits a contact.** Rejected by the founder's choice. It cannot
  heal the case where the person verifies on the side that was *left* with the
  copy, and a split made before such a change would still strand a sibling.
- **Promote by address, but hold a subscription made by another identity
  undeliverable until that identity verifies for itself.** Rejected by the same
  decision; it leaves the contact itself promoted, which is the thing the
  `status` column is meant to say is proven for *that* identity.
- **A single hop, then connectivity through any identity of the circle.** The
  first two drafts, both rejected in review. One hop leaves the copy of a
  membership moved twice two links from the identity holding the verification
  link, and retention then deletes that copy's consent. Connectivity through an
  identity makes two people one when that identity passed a place on and later
  took another in the same circle.
- **The transitive closure across circles.** Rejected: one identity that takes
  places in two circles would link the two people it took them from, so one
  person's verification would promote another's contacts. A chain within one
  circle is one membership's history.
- **Recording which contact a copy came from** (a lineage row written by
  `reconcile_contacts`). Exact, and would also connect two copies made from one
  contact into different circles, but it is a new record, written from now on
  and absent for earlier splits, and not what was decided. Left for the founder
  if the residual below matters.

## Consequences

- A person who lost their session and asked again under a new identity that was
  never reattached (an invite, not Continue-as) has two unrelated identities at
  one address. That is the case ADR 0009's uniqueness allows, and it is no
  longer healed by one click: the identity that verifies keeps its contact, the
  other is removed by retention, and the person's own fresh request is the one
  that counts.
- One migration, `0034` (ADR 0015): `private.same_person_identities` is new, and
  `public.verify_email_contact` and `public.claim_identity` change. No table
  changes. The new `member_claimed` row is not read by the Continue-as cap
  (`list_moves_this_week` reads `member_reattached` only), so a claim does not
  count against it, as before.
- **A link made by Continue-as is not proof of a person.** A reattachment from
  the list is made by whoever picks a name (ADR 0006, ADR 0048). A taker who
  has recorded a pending contact at an address, and then takes a guest's place,
  becomes directly linked to that guest, and the guest verifying that address
  would then promote the taker's contact. This is the founder's rule as decided,
  and the exposure is narrower than the one it closes (it needs the taker to
  take the place first, which tells the owner, and the guest to verify the very
  address the taker used), but it is not zero. Closing it means refusing the
  link from a place taken without proof, which strands a sibling in the one
  direction the split needs; put to the founder on the ticket, left as decided.
- **The identity at a junction is linked to everybody who passed through it.**
  If B took A's place, passed it on to C, and also took D's place, then B is
  directly linked to A, C and D, which is the founder's rule, and verifying as B
  reaches all three. A and D are not linked to each other: the walk from either
  of them never passes through B into the other's chain. B is the one identity
  that both places touched, and it is the one that can ask for an address on
  behalf of either, so verifying as it answering for both is the same exposure
  as the takeover residual above and no wider.
- **Residual: two copies of one contact, in two circles.** A person who moved
  circle one to a new identity B and circle two to a new identity D leaves the
  copies on B and D connected only through the identity they both came from. A
  link naming the original contact verifies both; a link naming one copy
  reaches the original but not the other copy, which then stays pending. The
  chains are per circle by design (see above).
- **Residual: ordering is by `occurred_at`, the transaction's start.** Two
  reattachments racing on one circle's lock can commit in the opposite order to
  their start times, so the chain can read with those two moves swapped: one
  false link between identities that already moved a place directly, and a
  sibling left pending until the person asks again. Needs millisecond
  concurrency on one circle and gains nobody anything beyond the takeover
  residual above; writing the row with `clock_timestamp()` would close it and
  was left out to leave `reattach_member` as SUS-103 reviewed it.
- Retention is unchanged: a pending contact still goes after seven days with its
  subscription. An identity that asked for updates at somebody else's address and
  never verifies it simply gets nothing, which is what `pending` has always
  meant.
- Nothing the screen shows changes. The answer is still the clicking
  identity's own plans and whether one is already locked in; the number of
  contacts promoted is in no response.
