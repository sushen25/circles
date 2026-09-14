# ADR 0020: The verification token is minted by whoever sends the email

_Status: accepted · Date: 14 September 2026_

## Context

Architecture §14's row for `request-email-updates` said the endpoint should
"issue the verification token, enqueue the verification email", and the first
implementation did exactly that: the Edge Function generated 32 random bytes,
sent the SHA-256 to `public.request_email_updates`, wrote the row in
`private.email_action_tokens`, queued a `verify_email` job — and then let the
readable half fall out of scope when the request returned.

There is no route from that request to the letter. `jobs.notification_jobs`
carries a channel, a kind, a recipient id, a plan, a revision and a key, and no
payload column. `jobs.outbox` refuses any event key named `token` or `email`
(`jobs.carries_content`). `private.email_action_tokens` stores a digest, which
is the point of it. So the dispatcher (S1-20) would have drawn a `verify_email`
job with nothing to render into the one button the email exists to carry, and
every token minted this way would have expired unused twenty-four hours later.

The gate could not see it: the database had a token row and a job, the handler
tests asserted the digest was well-formed and that the readable token was not
in the response, and both were true of a token nobody could ever use.

## Decision

**A token is minted at the moment the thing that carries it is sent.**

`public.request_email_updates` records the consent and enqueues the job.
`public.issue_verification_token(contact_id, token_hash)` — called through the
kit's `issueVerificationToken`, by the sender — spends the contact's previous
verification tokens, stores the digest of a new one, and returns its id. The
readable token therefore exists in exactly two places: the sender's memory for
the length of one send, and the email.

Three consequences follow and are deliberate:

- **"Resend invalidates the previous token" (spec §5.8) moves to the mint.**
  Two queued requests are two letters, and the second one's arrival is what
  kills the first one's link — which is what the sentence means and what a
  reader experiences.
- **The twenty-four hours start when the email is sent**, not when the button
  was pressed. A queue that is running late no longer eats a person's link.
- **`issue_verification_token` returns null rather than raising** when there is
  nothing left to verify — the contact was verified by another link, suppressed
  by a bounce, or removed by its owner between the request and the drain. For a
  dispatcher those are ordinary outcomes: the job is skipped, not retried.

The occurrence in the job's idempotency key is the **request id** rather than a
token id (architecture §13's `verify_email` occurrence, "the verification
request"). A retry never reaches the function — the idempotency claim in
`jsonHandler` answers it — and a genuine resend is a different request, so it
is a different key and a second email rather than a swallowed duplicate.

`public.issue_reentry_token` already worked this way and keeps doing so: the
Edge Function mints, the database stores the digest.

## Alternatives considered

- **Add a payload column to `jobs.notification_jobs`.** Rejected: it would be
  the one place in the system where a capability sits at rest beside the
  address it unlocks, in a table that is read by a cron job, kept for thirty
  days and dumped into every backup. §14's whole shape is that a job says
  *who* and *what*, and the content is assembled at send time.
- **Derive the token from the row id and a server secret.** An HMAC would let
  the sender recompute a token minted at request time. Rejected as more
  machinery for the same result: a new secret to hold and rotate, and a
  rotation would silently invalidate every live link.
- **Send the verification email synchronously from `request-email-updates`.**
  Tempting — `kinds.ts` already exempts `verify_email` from quiet hours because
  "somebody is standing at the screen waiting" — and rejected because it puts
  template rendering and the provider call in a second place, so a change to
  either has two homes and one of them will be missed.

## Consequences

- S1-19 (templates) and S1-20 (dispatcher) call `issueVerificationToken` when
  they draw a `verify_email` job, and treat null as "mark this job skipped".
  Both tickets carry a note saying so.
- `public.request_email_updates` no longer takes `p_token_hash`; it takes
  `p_request_id`. Nothing outside this slice calls it.
- A contact can hold a `verify_email` job with no token row until the job is
  drained, and **retention had to learn about that state**. Its seven-day rule
  for a pending contact spared one holding a live token; a contact whose token
  has not been minted yet looked identical to one that gave up a week ago. For
  a *new* contact the age check covers it, but a resend keeps the original
  `created_at` (`on conflict … do update`), so somebody who asked eight days
  ago, let the link lapse and asked again could have the run delete the
  contact, the queued email and the consent in the minute before the dispatcher
  drained it — having just been told to check their email. `jobs.run_retention`
  now also spares a contact with a scheduled `verify_email`.
