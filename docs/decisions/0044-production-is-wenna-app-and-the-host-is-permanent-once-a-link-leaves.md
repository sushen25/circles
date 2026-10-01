# ADR 0044: Production is `wenna.app`, and the host is permanent once a link leaves the founder

_Status: proposed · 1 October 2026_

## Context

Architecture §5.2 called `circles.app` a placeholder and said the real domain
would be chosen with the name, with a neutral holding domain until then. Spec
§21 listed the final domain as an open item, and ADR 0001's consequences said
the holding domain would be replaced before the external cohort. The holding
domain was `meet.sushensatturu.com`, on the founder's personal apex.

The product is now called Wenna (ADR 0043), and `wenna.app` was bought on
29 September 2026. No invite link and no product email has reached anybody but
the founder, so nothing in a group chat or an inbox depends on the holding
domain yet. That stops being true at the first dogfood group (SUS-48).

## Decision

- **Production's host is the apex `wenna.app`.** EAS Hosting attaches an apex
  with an A record, so no subdomain and no apex redirect are needed. Mail goes
  out from `mail.wenna.app` as `Wenna <hello@mail.wenna.app>`, and replies go
  to `hello@wenna.app`, which is forwarded to a mailbox somebody reads. All
  three live in `packages/config/src/brand.ts` and nowhere else.
- **The holding domain is retired with no redirect** (founder decision,
  29 September 2026). Nothing real ever pointed at it.
- **Once the first invite link reaches somebody who is not the founder, the
  host is permanent.** A later change of host needs the old one kept answering
  with a redirect for as long as links in group chats matter, which in
  practice means indefinitely. Emails also load their header images from the
  host (`/brand/*.png`), so the same applies to every email already sent.
- `dev` keeps its `expo.app` host. EAS Hosting allows one custom domain per
  project, and links are never shipped on `*.expo.app` (§5.2), which `dev`
  never does.

## Alternatives considered

- **`meet.wenna.app`, with the apex forwarding to it.** This was the fallback
  if EAS could not attach an apex. It can, and a subdomain would put a word
  into every link that the name no longer needs.
- **Keep the holding domain, with a redirect to `wenna.app`.** Nothing depends
  on it, and a redirect would need a second host outside EAS for no benefit.

## Consequences

- Architecture §5.2 names `wenna.app`. Spec §21's open item about the domain,
  and §5.1's note that the holding domain will be replaced, are closed. ADR
  0001's note that the holding domain will be replaced no longer applies.
- Turnstile, the Supabase Auth site URL, the production
  `EXPO_PUBLIC_APP_ORIGIN` and, when SUS-77 resumes, the Google and Apple
  clients are configured against `wenna.app`.
- Moving host again is no longer cheap. It needs a redirect host, the Google
  web client re-created, and the old host serving `/brand/*.png`.
  `docs/runbooks/environments.md` ("If the host ever has to change") lists the
  steps.
