# ADR 00XX: The preferences link is minted with each email, and both footer links open it

_Status: accepted · Date: 19 September 2026 · numbered when rebased onto main (SUS-82 takes 0024)_

## Context

Every plan-update email carries **Stop emails for this meetup** and **Manage
email preferences**, both working without sign-in (spec §5.8). S1-18 built the
page they open (`/e#<token>`, ADR 0023) and the function behind it
(`public.email_preferences`), but nothing issued a preferences token: the live
tests inserted one by hand. S1-19 writes the emails, so it has to decide three
things the earlier records left open.

**When the token is made.** ADR 0019 made a preferences token reusable for
ninety days, and listed "mint a fresh one in every email" as a rejected
alternative — rejected together with making it single-use, and for two reasons:
a reader of an older email would find a dead link, and every send would write a
token row. ADR 0020 then settled that a token is minted by whoever sends the
thing that carries it, because a job row holds ids and no payload and the token
table holds a digest: the readable half of a token minted earlier has no way to
reach the letter. Those two records together leave one shape.

**What "Stop emails for this meetup" opens.** The `/e` page lists the contact's
plans, each with a one-tap stop, and reads nothing from its link but the token
(`EmailPrefsFlow`). The original ticket drew the link as `/e/<token>?plan=`.

**Whether to offer one-click unsubscribe.** RFC 8058's `List-Unsubscribe-Post`
lets a mail client unsubscribe without opening anything, by POSTing to the URL
in `List-Unsubscribe`. Gmail and Yahoo require it of bulk senders.

## Decision

**A preferences token is minted for each plan-update email, at send time, for
the contact the email is going to** — `public.issue_preferences_token`, through
the kit's `issuePreferencesToken`. It is reusable and lasts ninety days, as ADR
0019 says, so an older email's link still works: only the "every send writes a
row" half of 0019's objection applies, and it is the price of never storing a
readable token. Retention removes each row a week after it expires. Null means
the contact is no longer verified, and the job is skipped.

**Both footer links open `/e#<token>`.** The page shows this meetup with a stop
beside it, one tap away. Carrying the plan in the link would need a second value
in the fragment beside the token — a new link shape in `deeplinks.ts` and a
change to S1-30's screen — to save a tap on an unsubscribe that already takes
one. Carrying it in the path or the query, as first drawn, would put "somebody
at this address is in this plan" into the web host's request log, which is what
ADR 0023 moved the tokens out of.

**`List-Unsubscribe: <https://…/e#<token>>`, and no `List-Unsubscribe-Post`.**
A one-click POST goes to the URL itself, so the token would have to be in a part
of the URL a server receives, and so in a request log. The header still gives a
mail client's own unsubscribe control somewhere to go. This is transactional
mail to a handful of people per plan, well below the bulk-sender threshold.

**Organiser emails carry no stop link.** `options_ready`, `replies_closed`,
`did_it_happen` and `about_time` go to the organiser, or the nudge's one
recipient, because they have no push device (review C6). They are not a
subscription, `/e` does not list them, and a "stop these emails" link that did
not stop them would be worse than none. They say why they arrived instead.

## Alternatives considered

- **One long-lived preferences token per contact, reused in every email.**
  Rejected: the readable token is not stored anywhere, so a second email
  cannot contain it. Storing it, or deriving it from a server secret, is what
  ADR 0020 rejected for the verification token, for the same reasons.
- **A plan in the fragment, `/e#<token>.<plan>`.** Rejected for now as above;
  it is a small change to make later if the extra tap turns out to matter.
- **RFC 8058 one-click with the token in the query.** Rejected: it is the
  token-in-a-log that ADR 0023 closed, for a feature the product's volume does
  not require.
- **A stop link on organiser emails that opens `/e`.** Rejected: the page would
  list plan subscriptions and nothing that stops the email the link came from.

## Consequences

- `issue_preferences_token` exists and the e2e helper `prefsTokenFor` mints
  through it; it returns null for a contact that has not verified.
- Every plan-update email writes one `prefs` row; a busy plan with six
  subscribers and five emails writes thirty. Retention keeps that bounded.
- **How an organiser stops organiser email is still open.** Today it is
  "install the app", which the spec already says ends them. An email-level stop
  for these would be a new preference, not a link to `/e`, and is the
  founder's call.
- If the bulk-sender rules ever apply, one-click needs a mechanism that keeps
  the token out of the request line. This header cannot be it.
