# ADR 0055: After sending, one step keeps the guest's place and turns on the plan's updates

_Status: proposed · 6 October 2026 (amended the same day, see the last section) · amends spec §5.1 and §5.11 (the Times-sent prompts) and [ADR 0019](0019-consent-is-recorded-when-it-is-given.md)'s reading of what proves a contact for a signed-in person; builds on [ADR 0027](0027-the-organisers-auth-address-is-an-email-contact.md), [ADR 0048](0048-the-consent-sentence-is-the-one-string-that-lives-in-config.md) and [ADR 0050](0050-verifying-an-address-promotes-only-the-same-persons-contacts.md)_

## Context

After a guest sent their times, Sent offered two things, each with its own email
and its own proof: a card for this plan's updates (an address and a verification
*link*, no account) and, under it, a quiet "Save access on every device" link to
a second screen (the same address again, a *code*, an account). Two screens, two
emails, one address typed twice. The founder reviewed an interactive mockup on 6
October 2026 and asked for one step.

## Decision

**1. One card, one primary.** Sent shows an address, the consent sentence, a
"Save my place in {circle}" switch **on by default**, and one primary, "Email me
about this meetup". The primary's own words are the consent; no pre-ticked box
exists. "Not now" is final for the visit and records nothing, and the card is
offered once per plan, as before (§5.11). The organiser never sees it.

**2. The switch decides the proof.** On: a sign-in code is emailed, entering it
saves the place (`savePlace`, `claim-identity`, moment `after_answer`) and then
turns on this plan's updates for that address. One email, the code, and no
verification link. Off: today's path, the verification link and Check your
email, no account. There is no "save my place and no emails" option: the account
is a by-product of the updates.

**3. A confirmed sign-in address is proof for the caller's own contact.**
`request_email_updates` creates or promotes the caller's contact verified when
the address asked for is the caller's own `auth.users` address, confirmed
(`email_confirmed_at` set) and not anonymous (via `dispatch_organiser_contact`,
ADR 0027). A verification link and a confirmed sign-in are two ways of obtaining
the same proof. The rule stops at the caller: another identity's pending contact
at the same address is not promoted (ADR 0050), a different address takes the
link path, an anonymous caller is unchanged, and a suppressed address stays
suppressed and sends nothing. A subscription made this way for a plan already
locked in queues the current "locked in" letter once, with the dispatcher's own
key, as a late verification does.

**4. The consent sentence is shorter, as a new version.** `2026-10-06`: "Only
about this meetup: when it's locked in, moved, called off or needs your times
again, one reminder, and one question after. Stop any time from the email
itself." The earlier versions stay on the list unchanged.

**5. The spec follows.** §5.1 now says the email card carries the "Save my place"
switch and the separate "Save access" link is no longer on Sent; the screen
remains for the Continue-as prompt and the organiser gate (§5.11).

## Alternatives considered

- **Keep two steps and only remove the repeated address.** Rejected by the
  founder: the second email and the second screen are the cost.
- **A pre-ticked consent box beside the switch.** Rejected: the button's own
  words are the consent, and a ticked box is what the Spam Act's guidance warns
  against.
- **A separate "just save my place" option.** Rejected by the founder; the
  account is not a separate ask.
- **Verify by link even when the address is confirmed.** Sends a second email to
  somebody who has just proved the address with a code, for no added assurance.

## Consequences

- One migration, `0039` (ADR 0015): `public.request_email_updates` changes. No
  table changes.
- A suppressed address typed by its confirmed owner still ends on "Done. We'll
  email ...": the endpoint answers the same whatever happened (SUS-46), so the
  client cannot tell. The case needs an address that bounced and then received a
  working sign-in code; recorded as a residual.
- A signed-in member with no switch who types their own confirmed address is
  taken to Check your email although no link was sent, for the same reason.
  Worth a copy follow-up.
- `email_submitted` carries `save_place` (boolean, optional) so the two paths can
  be compared.


## Amended 6 October 2026 (SUS-164): the member's one button, and an honest answer for the address's owner

_Amends decisions 1 and 3 above and the first two consequences. Nothing above is edited: this is the later word._

### Context

Two things were left by the one-step card. A signed-in member was asked for an address they had already proved (a saved member sees no switch, but still got the field; typing their own confirmed address made the server turn the emails on and send nothing, while the client waited on a link that never came). And an address on the suppression list, typed or carried through the code by its confirmed owner, ended on "Done. We'll email ..." although nothing would ever be sent.

### Decision

**6. A signed-in member with a confirmed address gets one button.** The session carries `confirmedEmail` (the sign-in address, only when `email_confirmed_at` is set and the identity is not anonymous; in memory, held where `supabase-js` already holds it). The card then shows "We'll email you at {address}.", the consent sentence directly above the button, "Email me about this meetup" and "Not now". There is no field, no switch and no "use a different address" (founder's decision). One tap calls `request-email-updates` with that address and `CONSENT.version`, and shows the done line; Check your email is never reached from here. A signed-in account with no confirmed address (rare) keeps the field and the link path, and an anonymous guest keeps the card of decision 1.

**7. The owner, and only the owner, is told the truth.** `request_email_updates` (migration `0040`) adds `delivery` (`live`, `pending` or `suppressed`) to its answer **only when the address asked about is the caller's own confirmed sign-in address**: `auth.users.email_confirmed_at` set, not anonymous, the same normalised address (the test decision 3 already uses to promote their contact). The Edge Function passes the word on if it is one of the three and otherwise answers exactly `{ "status": "check_email" }`, byte for byte as before. The decision is made in the database, once, beside the proof rule, so the two cannot disagree. Anyone asking about an address that is not their confirmed one (somebody else's, live or suppressed; an unconfirmed address; an anonymous caller) learns nothing new, so nobody can probe another address; and the owner learns only about their own, which they proved with a code.

**8. A suppressed address is never promised email.** `live` (or no `delivery`, an older answer) gives the done line. `suppressed` gives, for the member's button, "We can't send email to {address} right now, so check the plan here.", and after the switch-on code path "Your place is saved. We can't send email to {address} right now, so check the plan here." Both are warnings in the same live region, and neither says "We'll email". `pending` (a link was sent) cannot be produced for an owner today, because their contact is promoted verified before the answer is made; it is kept in the contract so a future change cannot add a fourth state silently, and the screens read it like `live`.

### Alternatives considered

- **Tell every caller `delivery`.** Rejected: it is the probe the endpoint was built to prevent (SUS-46), and a suppressed address asked not to hear from us, which outranks telling a third party about it (spec §9).
- **A separate "what is the status of my address" read.** Rejected: one more endpoint and one more place for the owner test to drift; the answer to the request they just made is where they are looking.
- **A "use a different address" link on the one-button card.** Rejected by the founder.
- **Deciding ownership in the Edge Function.** Rejected: it would repeat the database's test, and the database is where a confirmed address already counts as proof.

### Consequences

- One more migration, `0040` (ADR 0015): `public.request_email_updates` returns `delivery` for the owner. No table changes; the contract's response gains an optional `delivery`.
- Closes both residuals recorded above: the suppressed owner no longer ends on "Done. We'll email ...", and the signed-in member no longer reaches Check your email for an address that sent nothing.
- The session state gains `confirmedEmail`. It is the address `supabase-js` already holds for the session, kept in memory, and it is never put in a URL, a log or an analytics payload (non-negotiable 8). The member's `email_submitted` carries no `save_place`, because there was no switch.
- pgTAP `350` and the handler tests cover allow and deny: own and live, own and suppressed, someone else's address (live and suppressed), anonymous, unconfirmed, and that a non-owner's response has no `delivery` key.
