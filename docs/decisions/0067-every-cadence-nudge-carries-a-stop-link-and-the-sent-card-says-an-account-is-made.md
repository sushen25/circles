---
adr: 67
title: "Every cadence nudge carries a stop link that needs no sign-in, and the Sent card says an account is made"
status: proposed
date: 2026-10-11
amends: [27, 55]
builds_on: [23, 25, 29, 36, 48]
---
# ADR 0067: Every cadence nudge carries a stop link that needs no sign-in, and the Sent card says an account is made

_Status: proposed · 11 October 2026 · amends [ADR 0055](0055-after-sending-one-step-keeps-your-place-and-turns-on-the-updates.md) (what the card says), [ADR 0027](0027-the-organisers-auth-address-is-an-email-contact.md) (what mail an auth address can receive) and, for `about_time` alone, the sentence in [ADR 0025](0025-the-preferences-link-is-minted-with-each-email.md) that organiser letters carry no stop link; builds on [ADR 0023](0023-emailed-tokens-travel-in-the-fragment.md), [ADR 0029](0029-an-organiser-turns-organiser-email-off-in-the-app.md), [ADR 0036](0036-the-cadence-nudge-is-decided-once-per-cycle.md) and [ADR 0048](0048-the-consent-sentence-is-the-one-string-that-lives-in-config.md)_

## Context

SUS-190 (finding M17 of the security review of 9 October 2026). Since ADR 0055
the Sent card has a "Save my place in {circle}" switch **on by default**. Saving
a place makes a permanent account whose confirmed address is a contact (ADR
0027), and that account is then nudgeable: `isNudgeable` is "active, permanent,
not muted", `take_turns` rotates among attendees, and the dispatcher sends
`about_time` to the address. The letter offered only "Turn these off in
notification settings", which needs a sign-in the person may never have been
told they have. The card did not say an account is made, that it can receive
mail other than the plan's, or link the terms (18 and over) or the privacy page,
and `/privacy` gave a trigger for nudges ("If you sign in to organise plans or
start a quiet ask") that is not the real one.

A circle's cadence defaults to `none`, so this fires only where an owner has set
one. The founder chose on 10 October 2026: **every cadence nudge carries a stop
link that needs no sign-in, and the Sent card says so.** The alternative, muting
accounts made from the Sent card until they opt in, was not chosen.

## Decision

**1. Every `about_time` email carries a stop link.** "Not for you? Stop these
reminders", above the existing settings pointer, opens `/n#<token>`. The token
is in the fragment (ADR 0023), so no server holds it. The same URL is the
email's `List-Unsubscribe` header, so a mail client's own unsubscribe control
reaches the same place. There is no `List-Unsubscribe-Post`, for the reason ADR
0025 gave: a one-click POST goes to the URL itself, and the token would then sit
in a request log. A nudge whose contact cannot be given a token (it is not
verified, or belongs to nobody) is **skipped**, not sent without a stop
(`contact_unverified`).

**2. The page asks for one tap and does nothing before it.** `/n` shows "Stop
these reminders" and a button. Loading the page reads nothing and writes
nothing, so a mail gateway or a link scanner that opens the link, even one that
runs the page's script, stops no reminders. The tap posts the token to
`stop-nudges`. This is the pattern SUS-186 asks of `/a` and `/v`; `/n` is built
that way from the start, and a note is left on SUS-186.

**3. The token is its own kind, scoped to one person and one kind of mail.**
`email_action_tokens.purpose` gains `nudge_stop`. It is minted per letter, at
send time, for the contact the letter goes to (`issue_nudge_stop_token`; the
rule of ADR 0020 and ADR 0025), stored as a digest, reusable and valid for a
year: a stop link that died after one tap, or after ninety days, would not be
one. `stop_nudges` accepts that purpose only. A preferences token cannot stop
nudges; this one cannot read or stop plan email or remove the address; one
person's token never reaches another person. An unknown, tampered, expired or
other-purpose token is the same `link_expired`.

**4. What it stops.** It sets `circle_members.muted_nudges` (the switch "Nudges
to plan the next one", ADR 0029) for the token's owner in **every circle they
are an active member of**: someone who asks for the reminders to stop has not
asked for them to stop in one circle only. `isNudgeable` already honours that
flag, so under every policy the person is not asked, and under `take_turns` the
turn passes on. A nudge already queued behind quiet hours is skipped
(`nudge_stopped`). Nothing else changes: plan email, organiser letters, push and
the address itself are untouched, and the person can turn the switch back on in
notification settings. The page and the answer reveal nothing: `{ "stopped":
true }`, no name, no circle, no address. Repeating the tap is harmless. No event
or log carries the token.

**5. The card says what happens.** With the switch on, the card's second line
reads, exactly:

> This makes you an account in {brand}, so you can get back in from any phone. Reminders about catching up can be stopped from the email itself.

followed by "For people 18 and over. Read the terms and privacy." with both as
links (`/terms`, `/privacy`). With the switch off the line stays "Nothing is
saved." and nothing is linked, because nothing is made. This line is a notice
about the account, not the consent for plan updates: **`CONSENT.text` is not
changed, so its version stays `2026-10-06`**. The recorded consent still says
what the person agreed to for this plan's emails; the nudge is not part of that
consent, it is a letter an account holder may get, and it carries its own stop.
The sentence is recorded here, and in `en.ts` (`sent.makes_an_account`), the one
place it is rendered from. If it later has to be recorded against an account (a
second consent, not this ticket), it becomes a versioned string like
`CONSENT`.

**6. `/privacy` states the real trigger.** The sentence in "What email you get"
now says an occasional nudge to plan the next one goes to someone with a saved
place in a circle that has a catch-up rhythm, with a link in the email to stop
it without signing in. The same fact is corrected in the in-app Privacy screen.

## Alternatives considered

- **Mute accounts made from the Sent card until they opt in** (not chosen by the
  founder). It would have meant a flag set at account creation, a settings state
  nobody sees until they sign in, and a circle whose take-turns rotation skips
  every guest who saved a place. The stop link is the same promise the plan
  emails already keep, and it works for the organiser who signed in to organise
  as well.
- **Reuse the preferences token and `/e`.** Rejected: that token can remove an
  address, and `/e` lists plan subscriptions the nudge is not one of. A stop
  that opens a page about something else is not a stop (ADR 0025's own
  reasoning for organiser mail).
- **Stop on load.** Rejected: opening the link would spend it, so a gateway
  could silence a person's reminders without their knowing (SUS-186).
- **Stop in the one circle the letter is about.** Rejected: the person said "stop
  these", and the next circle's nudge would carry the same request again.

## Consequences

- Migration `0052`: the `nudge_stop` purpose, `public.issue_nudge_stop_token`,
  `public.stop_nudges`. New Edge Function `stop-nudges` (no JWT, rate limited
  like its siblings) and route `/n`. pgTAP `460`, handler, dispatcher, render,
  domain, page and card tests, and one step in the live cadence spec.
- ADR 0025's "organiser emails carry no stop link" is now false for `about_time`
  and true for the others. Options ready, did it happen, replies closed and the
  quiet-ask letters still carry none: that is SUS-110, which can reuse
  `nudge_stop`'s shape (purpose, issue and stop functions, `/n`-style page) per
  kind.
- The nudge's recipient list does not change; a person who stops is passed over
  as one who turned the switch off in settings is.
- The tapper cannot tell, from the page, whether they have reminders on in
  other circles. That is deliberate (it reveals nothing); notification settings
  is where they see it.
