---
adr: 63
title: "The calendar file is served at a link with a short-lived signed token"
status: proposed
date: 2026-10-11
builds_on: [51]
---
# ADR 0063: The calendar file is served at a link with a short-lived signed token

_Status: proposed · 11 October 2026 · amends how `generate-ics` is authorised (architecture §9 and §14), and builds on [ADR 0051](0051-the-organiser-sets-the-final-plan.md), which made one calendar entry follow a move_

## Context

`generate-ics` is a GET behind the member's bearer. A browser cannot send a
bearer on a navigation, so the confirmed screen fetched the file with the bearer
and handed the bytes to the platform through a blob link
(`<a download>`). On iPhone Safari that asks "Download …ics?", puts the file in
Downloads and leaves the person to find it in Files and tap it: about four steps
where the platform offers one. iOS Safari opens a `text/calendar` response
served at a plain HTTPS URL straight into the system "Add to Calendar" sheet,
with no Downloads and no Files (SUS-154). The founder chose to build that on
11 October 2026.

A plain URL needs an authorisation a navigation can carry, and the only thing a
navigation carries is the URL. Architecture §14 says an `.ics` holds no tokens;
that is about what is *in the file*, and stays true. This decision is about the
*link the file is served from*.

## Decision

**`generate-ics` serves the file to a request that carries a short-lived signed
token in the query string and no bearer.** The member's bearer still works
exactly as before and is still how the token is obtained.

- **Minting.** `GET generate-ics?confirmation_id=…&format=link` with the
  bearer. The caller's own client reads `meetup_confirmations`, so row-level
  security answers "may this person see this confirmation?" as it always did; a
  stranger and a confirmation that does not exist get the same refusal. The
  answer is JSON, `{ token, expires_at }`. With no key configured it is
  `{ token: null }`, and the app falls back to fetching the file with the bearer
  (the blob path), so a deployment without the secret loses the one-tap
  behaviour and nothing else.
- **The token** is `<exp>.<mac>`. `exp` is the expiry in whole seconds since
  the epoch. `mac` is base64url of HMAC-SHA-256 over
  `circles.calendar.v1:<confirmation_id>:<exp>` under `CALENDAR_LINK_KEY`, an
  Edge Function secret of its own (not `INVITE_LINK_KEY`, so rotating either
  touches only its own links). The context string is domain separation.
  **Lifetime 15 minutes. Scope: one confirmation, read only, GET only.**
- **Checking.** The function recomputes the MAC for the `confirmation_id` in the
  request and compares in constant time (`sameSecret`), and only then looks at
  the expiry. A token for another confirmation, a changed expiry, a changed
  signature and a malformed value are all the same refusal; an expired one is
  refused with the same status and no more detail. Only after a token verifies
  does the function read the confirmation, with the service client, because
  there is no caller to run row-level security as: the token *is* the
  authorisation, and it is bound to exactly one confirmation id.
- **No token, no bearer, no answer.** A request with neither gets 401 and reads
  nothing. With no key configured every token is refused.
- **The response** is `text/calendar; charset=utf-8`, `Content-Disposition:
  inline` (iOS Safari treats `attachment` as a download), and
  `Cache-Control: private, no-store`, so nothing outlives the token. It is
  built from the row on every request, so a moved, edited or cancelled meetup
  is told as it now is (ADR 0051), whatever the token was minted for.
- **What the file holds** is unchanged: day, time, place, note, the plan's
  short link and the circle's name, exactly what the `/p/` page and the
  locked-in share message already show. No token, no member list, no email
  address.
- **Where the token may be.** In the link and the request for it, and nowhere
  else: never in analytics, never in a log line (the function logs fixed
  fields and a request id, and the query string is never logged), never in the
  file, never persisted by the app. The app holds it in memory and builds the
  link at the tap.
- **The gateway.** `generate-ics` sets `verify_jwt = false`, as the email-link
  functions do, because the gateway has no JWT to check on a navigation; the
  function does its own authentication, for the bearer and for the token.
- **In-app browsers** (WhatsApp, Messenger, Facebook, Instagram, Android
  WebViews) keep the blob path: a WebView often has nowhere to put a navigation
  to a calendar file, and the file path is the one the end-to-end suite already
  exercises in those user agents.

**What the token does not do.** It is not single-use: iOS can request a link
twice (a preview, then the open), and a single-use token would turn that into a
refusal. So whoever holds the link can read the file for the rest of its 15
minutes. That is the accepted cost, and what they can read is what the plan's
public link already shows. There is no revocation short of expiry.

## Alternatives considered

- **Keep the blob download (B only).** Four steps on an iPhone, which the ticket
  was raised to remove. Kept as the fallback.
- **A long-lived or permanent calendar URL** (a subscription feed). A
  capability that outlives the meetup and is forwarded with the file. Rejected;
  a short expiry is the point.
- **A single-use token stored in the database.** Needs a table and so a
  migration, and breaks on the double request iOS makes. A signed token needs
  neither.
- **Putting the bearer (the member's JWT) in the URL.** A long-lived credential
  for the whole account in a URL that is logged by every proxy and kept in
  history. Never.
- **`Content-Disposition: attachment`.** Forces a download on iOS, which is the
  behaviour being removed.
- **Deriving the key from the service-role key.** Couples two rotations and puts
  one secret's compromise into the other. A separate secret costs one runbook
  row.

## Consequences

- One new Edge Function secret, `CALENDAR_LINK_KEY`: `"local"` in
  `config.toml`; `dev` and `prod` set their own (`openssl rand -base64 32`),
  listed in the environments runbook. **Until a deployment sets it the app uses
  the blob path**, so deploying the code first is safe.
- `generate-ics` gains `verify_jwt = false` in `config.toml`; the architecture's
  function table and token table say so, and the spec's confirmed-screen
  paragraph says what a tap does.
- No migration.
- The app fetches a token as the confirmed screen loads (the same early fetch
  SUS-154 part B added for the file), shows the same pending, slow and
  failed row states while it does, refreshes it before it expires, and fires
  `ics_downloaded` on the tap.
- Tests prove: an expired token, a token for another confirmation, a tampered
  token and a missing token are each refused and read nothing; a request with
  neither token nor bearer is refused; the answer is `text/calendar` and
  `no-store`; an unset key refuses every token.
- A real iPhone has not been used to confirm the system sheet opens; the
  behaviour is the platform's documented one and is the first thing to try after
  deploying.

_Status: proposed · 11 October 2026_
