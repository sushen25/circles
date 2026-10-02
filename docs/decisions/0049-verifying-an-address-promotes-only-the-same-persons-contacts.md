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
identity **directly** linked to it by a `circles.member_reattached` row in
`private.audit_log`, in either direction (the row records `from_user_id` and
`to_user_id` by id, written in the same transaction as the move). Nothing else
makes two identities one person: not the same address, the same circle, the same
device or the same time.

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
| A sibling left by `reconcile_contacts` on the identity a membership moved from, or the copy on the one it moved to, linked by `member_reattached` | verified |
| Another identity's pending contact at the address, with no recorded link | stays `pending`, its subscription undeliverable; retention removes both after seven days |
| The organiser's auth address (`dispatch_organiser_contact`) | unchanged: it already promoted only that user's own contact, so a different identity's pending contact at the same address is never touched |

**4. A claim is not a recorded link, and needs none.** `claim_identity` writes
one audit row, `growth.account_claimed`, which names the destination and not the
anonymous identity it came from, so it cannot be walked. It does not need to be:
a claim moves, or merges into the saved place's own contact, every contact the
guest holds for a circle it moves, through `reconcile_contacts`, and the carried
status stays (verified stays verified; a pending contact travels pending and is
verified by its own link or promoted by the rule above, as the same `user_id`).
What a claim leaves on the guest identity is only what belongs to circles the
guest is no longer an active member of, whose subscriptions are not deliverable
anyway (`email_recipients_for` requires an active member). Adding a new audit
row to the claim would invent a link for rows that predate it and buy nothing,
so none is added.

## Alternatives considered

- **Same `user_id` only, with `reconcile_contacts` carrying the verified state
  across when it splits a contact.** Rejected by the founder's choice. It cannot
  heal the case where the person verifies on the side that was *left* with the
  copy, and a split made before such a change would still strand a sibling.
- **Promote by address, but hold a subscription made by another identity
  undeliverable until that identity verifies for itself.** Rejected by the same
  decision; it leaves the contact itself promoted, which is the thing the
  `status` column is meant to say is proven for *that* identity.
- **The transitive closure of the audit links.** Rejected: one identity that
  takes several people's places would link all of those people to each other, so
  one person's verification would promote another's contacts. One link is the
  distance a split contact needs, because `reconcile_contacts` copies a contact
  to the identity directly on the other end of the move.

## Consequences

- One migration, `0034` (ADR 0015): `private.same_person_identities` is new, and
  `public.verify_email_contact` changes. No table changes.
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
- Retention is unchanged: a pending contact still goes after seven days with its
  subscription. An identity that asked for updates at somebody else's address and
  never verifies it simply gets nothing, which is what `pending` has always
  meant.
- Nothing the screen shows changes. The answer is still the clicking
  identity's own plans and whether one is already locked in; the number of
  contacts promoted is in no response.
