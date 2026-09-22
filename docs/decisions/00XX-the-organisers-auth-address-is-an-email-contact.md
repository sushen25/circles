# ADR 00XX: The organiser's auth address is an email contact, verified by auth

_Status: proposed · 22 September 2026_

> Drafted as `00XX` because two branches are open at once. The number is taken,
> and `docs/decisions/README.md` updated, in the rebase before merge.

## Context

Spec §5.8 sends four kinds to "the signed-in organiser … by email until they
install the app": options ready, replies closed, did it happen, and the
about-time nudge. The domain says the same in data — those are the rows with
`emailNeedsSubscription: false`, which is review C6 and the reason Slice 1
needs no native build.

The pipeline cannot address them. `jobs.notification_jobs` takes a `contact_id`
and no `user_id` on the email channel (`notification_jobs_recipient`, S1-11
round 5), and the delivery webhook suppresses by contact and by address hash
(`record_email_delivery`, S1-19). A recipient who is a `user_id` and nothing
else therefore has no row to be written to, no row to be suppressed, and no row
for a bounce to attach to. S1-19's handover note put it plainly: *either give
the organiser a contact row, or that design needs to change.*

The address itself is not in doubt. `auth.users.email_confirmed_at` is set by
GoTrue when somebody types back the code we emailed them, which is how every
saved-place identity in this product comes to exist (spec §5.1). We already
have proof they control the address; what we do not have is a row saying so in
the only table that holds an address (`private.email_contacts`, §14).

## Decision

**The organiser's confirmed auth address becomes an ordinary
`private.email_contacts` row, created `verified`, with no subscription.**

`public.dispatch_organiser_contact(user_id)` is the only thing that makes one.
It returns the contact id, or null — and null is an ordinary outcome meaning
"no reachable channel", which the domain already models as silence:

- null for an anonymous identity, and for a saved place whose address is not
  confirmed: we have no proof, so there is nothing to write to;
- null for a suppressed contact: a bounce or a complaint stops organiser email
  exactly as it stops plan-update email, and it is never reactivated (spec §9);
- the existing row, promoted from `pending` to `verified`, when the identity
  already has a contact at that same address.

Two things follow from what it does **not** do. It creates no
`private.email_subscriptions` row, so nothing here is consent to plan-update
email: that consent is per plan, asked for explicitly, and is what
`private.email_recipients_for` reads. And it writes no address anywhere else —
the contact holds it, as the only table that may.

`email_contacts.status` is therefore read as *whether we have proof this
identity controls this address*, and a verification link and
`email_confirmed_at` are two ways of obtaining the same proof. That reading is
what makes the promotion of a `pending` contact correct rather than convenient.

## Alternatives considered

**Widen `notification_jobs_recipient` to allow a `user_id` on the email
channel.** The constraint would then say "one of these two", and every reader —
the webhook's suppression, `reconcile_contacts`' re-pointing of queued mail,
retention's contact rule — would need a second branch for a recipient whose
address lives in `auth.users`, a table none of them may read. The suppression
list is by address hash; a recipient with no hash cannot be on it. This is the
alternative that quietly makes "hard bounces suppress immediately" untrue for
one class of message.

**Read the address at send time from `auth.users` and never store a contact.**
Same failure, one step later: the send would work and the bounce would have
nowhere to land. It also puts an address in a code path that has no row to log
against, and `sendEmail` logs a contact id precisely so that it never logs an
address.

**Leave a `pending` contact pending, and send the organiser nothing.** This is
the conservative reading, and it is wrong in the one case it changes:
an organiser who once typed their own address into a plan's "email me updates"
and never opened the letter would silently receive no organiser mail at all,
for a reason they could not see and we would not notice. The address is proven;
refusing to use it protects nobody.

**Ask the organiser to subscribe to their own plan.** It is the same consent
mechanism doing a different job, and it puts a verification email between the
organiser and the first message the product owes them — "your options are
ready" — which is the message that makes the product work at all.

## Consequences

- A permanent identity that organises anything gains one `email_contacts` row,
  created the first time an organiser kind is enqueued for them. It carries no
  subscription, so `private.email_recipients_for` never returns it.
- **Retention had to learn about it.** `jobs.run_retention` deleted a verified
  contact with no active subscription thirty days after it was verified, on the
  premise that every contact in the MVP is a plan's. This one is not: it is an
  identity's, and it holds no subscription by design. Left alone, the rule
  deleted an organiser's contact a month after their first plan — and
  `notification_jobs_contact_fkey` is `on delete cascade`, so the "did it
  happen?" letter due at nine the next morning went with it, silently. The rule
  now keeps a contact that is its owner's confirmed auth address, and
  separately keeps any contact with a job still waiting, which is right
  whoever's address it is.
- A bounce or a complaint on that address suppresses it, withdraws any
  subscriptions at the same address and skips its queued jobs — the existing
  machinery, unchanged. The organiser then receives nothing by email, which is
  correct and is a state S4-06's diagnostics screen should surface.
- Turning organiser email **off** is not a link on these letters: they carry no
  preferences token, because a preferences token is scoped to a plan-update
  subscription that does not exist. SUS-83 owns the setting that turns them off
  in the app, and until it lands there is no way to stop them but to bounce.
- A `pending` contact at the same address is promoted to `verified` by this
  function. If that identity also had an unverified plan-update subscription at
  that address, that subscription becomes deliverable. This is deliberate — the
  consent was given and the address is proven — and it is the one consequence
  worth disagreeing with. Disagreeing with it means refusing to send organiser
  mail to an address the product is already certain of, which is the third
  alternative above.
- The seed now sets `email_confirmed_at` for its permanent identities, because
  they represent people who signed in with a code. Without it every local
  scenario was one in which organiser email silently did not exist.
