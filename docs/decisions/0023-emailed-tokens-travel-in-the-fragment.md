# ADR 0023: Emailed tokens travel in the URL fragment

_Status: accepted · Date: 19 September 2026_

## Context

Non-negotiable 8 and spec §8.2 say no log ever holds a token. Three of the six
links the product puts into the world (architecture §5.2) carried a real token
in the **path**:

- `/a/<token>`: re-entry from an email. Single use, seven days, and it moves a
  membership.
- `/v/<token>`: email verification. Single use.
- `/e/<token>`: email preferences. It stays valid after use (ADR 0019) and it
  changes what somebody receives.

A path is part of the request line, so the web host's request logs (EAS
Hosting) held every one of these tokens, and so would any proxy, antivirus
scanner or analytics tool that records URLs. The circle invite never had this
problem: its secret rides in the fragment (`/join#<secret>`), which browsers
do not send to any server, and the client takes it out of the address bar
before the router loads (S1-24, `captureInviteFragment`).

SUS-81 found the gap while ADR 0022 was being reviewed. No email had been sent
to anybody yet — S1-19 and S1-20, which write and send them, were not built —
so no link in the wild could break. The founder chose to close it inside S1-30
(SUS-46), which builds the `/v` and `/e` screens.

## Decision

**Every emailed token travels in the fragment: `/a#<token>`, `/v#<token>`,
`/e#<token>`.** The paths carry nothing but the kind of link.

- The app's entry point takes the token out of the address bar before the
  router is evaluated, exactly as it does for `/join`, and holds it in memory
  for the one screen that needs it. The router never sees it, so it is never
  written back into history.
- The screen posts it to its Edge Function in the request body, as they
  already required: a GET is a prefetch, and a prefetch must not spend a
  single-use token.
- `packages/contracts/src/deeplinks.ts` parses all four capability links from
  the fragment and builds them, so the email templates (S1-19) have one
  function to call and cannot put a token in a path by hand.
- A reload after the capture shows the link's "open it again from your email"
  state. The token is gone from the page by design; keeping it would mean
  keeping it where the router, and history, can see it.

## Alternatives considered

- **Narrow the rule instead:** emailed tokens may sit in a path because they
  are single use or low value. Rejected: `/e` is neither, and "the logs hold
  tokens, but only some kinds" is a rule nobody can check.
- **A query string (`/v?t=`).** Also sent to the server and logged. No better
  than the path.
- **POST from the email.** Email clients do not submit forms reliably, and a
  link is what the artboards and the templates assume.

## Consequences

- Architecture §5.2 and the email re-entry paragraph in §10 describe the
  fragment form. `docs/runbooks/environments.md` lists the routes that way.
- The live e2e re-entry tests open `/a#<token>` and assert that no request
  the page makes has the token in its URL.
- **Link rewriters must keep the fragment.** Outlook SafeLinks and most
  corporate gateways wrap the whole URL and restore it on click, fragment
  included, but this is untested against a real gateway. S1-31 (SUS-47)
  should test at least one before the first cohort.
- Native universal links (S3-01) carry the fragment to the app unchanged;
  the native entry point will need the same capture.
