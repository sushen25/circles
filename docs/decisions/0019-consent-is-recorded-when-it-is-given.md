# ADR 0019: Consent is recorded when it is given, and a preferences link does not expire on use

_Status: accepted · Date: 14 September 2026_

## Context

Architecture §9.1 described the email pair as `request-email-updates` creating
"contact + subscription (pending)" and `verify-email-contact` "activating" the
subscription. §14's tokens row said all three kinds — verification, preference,
re-entry — are "≥256-bit, hashed, **single-use**, expiring".

Both descriptions predate the tables. `private.email_subscriptions.status` is
`active | withdrawn` and nothing else, with a check tying `withdrawn` to a
`withdrawn_at` timestamp; there is no third state for "asked but not yet
proven". And a preferences link is the thing every event email carries so that
somebody can stop the email without signing in — the Spam Act answer, and spec
§5.8's "links that work without sign-in".

## Decision

**A subscription is `active` from the moment it is asked for, and the
*contact* carries the unproven part.** `private.email_recipients_for` is the
one query that decides who may be emailed about a plan, and it requires a
verified contact, an active subscription and an active membership. An address
somebody typed wrong therefore receives nothing, while the row says honestly
what was agreed, when, and to which words (`consent_text_version`).

Writing `withdrawn` before anybody withdrew would be the alternative, and it is
a worse lie in the other direction: `withdrawn_at` would carry a time nobody
chose, and an unsubscribe record would be indistinguishable from a consent that
had not been confirmed yet — in the one table whose job is to say which is
which.

**A `prefs` token is long-lived and is not consumed.** Ninety days, reusable.
An unsubscribe link that worked once and then expired would be an unsubscribe
link that does not work: the second time somebody taps it — from a different
email, or after a page reload, or because the first tap was a mail scanner's —
they would be told their link is broken while the email keeps arriving.

`verify` and `reentry` tokens stay single-use, which is what §14's sentence is
about: those two *grant* something — a verified address, a way back into a
circle — and granting twice is a capability somebody can replay. Stopping mail
is not a capability; it is a refusal, and repeating a refusal changes nothing.

Architecture §9.1 and §14 are corrected to say both.

## Alternatives considered

- **Add a `pending` status to `email_subscriptions`.** Rejected: it would
  duplicate what `email_contacts.status` already says, in a second place, and
  the two would disagree the first time a contact was verified by a link
  belonging to a different plan.
- **Create the subscription at verification instead.** Rejected: the token
  records a contact, not a plan, so verification would not know which plan was
  asked for — and the consent would be dated to the click rather than to the
  moment the person actually agreed, which is the date the Spam Act cares about.
- **Make the prefs token single-use and mint a fresh one in every email.**
  Rejected as worse on both counts: a person reading an older email would find a
  dead link, and every send would write a token row whether or not anybody
  tapped it.

## Consequences

- `private.email_recipients_for` is load-bearing. Anything that sends
  plan-update email goes through it (S1-20), and adding a sender that does not
  is how mail reaches a pending contact.
- A subscription row exists, active, for an address that may never be verified.
  Retention deletes a pending contact after seven days and the cascade takes the
  subscription with it, which is the right end for a mistyped address.
- The preferences token outlives the plan it was first sent about, by design:
  ninety days is longer than most plans and shorter than a forgotten mailing
  list.
