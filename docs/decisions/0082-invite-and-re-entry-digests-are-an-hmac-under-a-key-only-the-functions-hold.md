---
adr: 82
title: "Invite and re-entry digests are an HMAC under a key only the Edge Functions hold"
status: proposed
date: 2026-10-19
amends: [28, 73]
builds_on: [49]
---
# ADR 0082: Invite and re-entry digests are an HMAC under a key only the Edge Functions hold

_Status: proposed · 19 October 2026 · amends [ADR 0028](0028-an-invite-secret-is-derived-so-its-owner-can-see-it-again.md), which stored the SHA-256 of an invite secret, and [ADR 0073](0073-an-invite-digest-and-a-re-entry-digest-are-not-a-way-in.md), which made the functions that take a digest the service role's but left `invite_preview` to `anon` and the HMAC as a follow-up, and builds on [ADR 0049](0049-continue-as-resolves-a-code-only-while-it-is-live.md), which defined the emailed re-entry path_

## Context

An invite secret (the Join link's fragment) and an emailed re-entry token are
stored as a plain SHA-256 (ADR 0028, architecture §14). ADR 0073 made sure no
client can *call* a function with a stored digest, but the digest is still
reproducible by anyone who holds a copy of `circle_invites` or
`private.email_action_tokens` and can hash a guess, and the Join page computed
the same function in the browser. Both ADR 0028 and ADR 0073 named an HMAC under
a server key as the next layer and left it as a follow-up (SUS-214).

The key in question is not `INVITE_LINK_KEY`. That one *derives* an invite
secret from the invite's id so the owner can be shown the link again; it is
optional, and rotating it is a documented, harmless operation (the old links keep
working and stop being showable). A digest key that was the same value would turn
that rotation into the end of every link. No other HMAC secret exists to reuse
(`CALENDAR_LINK_KEY` signs calendar tokens and `RESEND_WEBHOOK_SECRET` verifies
a provider's), and one key should not do two jobs.

Links already exist in group chats and in emails, so the change has to say what
happens to them.

## Decision

**A new digest is HMAC-SHA-256 under `INVITE_DIGEST_KEY`**, a secret held by the
Edge Functions and never by the database or a client:
`HMAC(INVITE_DIGEST_KEY, "circles.digest.v1:<purpose>:" + value)`, where the
purpose is `invite` or `reentry`, so a digest for one is not a digest for the
other. `supabase/functions/_shared/digest.ts` is the only place it is computed.

- **Required, and fails closed.** A function without the key answers 503 and does
  nothing: it stores nothing, looks nothing up, spends no Turnstile token and
  charges no allowance. It never falls back to SHA-256 for a *new* digest, on a
  laptop or anywhere else. On a hosted project (the test `verifyTurnstile` uses)
  a key shorter than 32 characters is refused too, because the value
  `supabase/config.toml` carries for a local stack must not be what protects a
  hosted one. Locally the key is `local`, set in `config.toml` beside
  `INVITE_LINK_KEY`.
- **Where it is used.** `create-circle` and `rotate-invite` store the HMAC of the
  secret they derive. `redeem-invite` and `invite-preview` hash the fragment they
  receive. `issueReentryToken` stores the HMAC of the token it mints and
  `reattach-member` hashes the token it receives. `get-invite-link` compares
  the HMAC (or, for an older link, the SHA-256) of the secret it re-derives.
- **Each stored digest says which kind it is.** `circle_invites.digest_kind` and
  `private.email_action_tokens.digest_kind` are `sha256` or `hmac`. Every row
  that existed is `sha256`, and the column default stays `sha256`, which is also
  right for the verification, preferences and stop tokens this does not change.
  The caller of the functions that store a digest (`create_circle`,
  `issue_invite`, `issue_reentry_token`) says `hmac` with a `digest_kind`
  argument, which the new Edge Functions always do. The default is deliberate:
  migrations are pushed before the functions are deployed, and until then the old
  functions keep sending a plain SHA-256 through the same RPCs. A default of
  `hmac` would label those rows falsely and the new lookups would never find
  them; with `sha256` they are labelled truthfully and dual-read serves them. The
  default can go when the legacy path does.
- **The functions that look a digest up take two.** `redeem_invite`,
  `invite_preview` and `reattach_with_token` (and the core they share) take the
  HMAC and, beside it, the SHA-256 of the same secret as `p_legacy_hash` /
  `p_legacy_token_hash`. The HMAC matches only a row stored as `hmac` and the
  legacy digest only a row stored as `sha256`, so neither slot can stand in for
  the other: a stored SHA-256 offered as the current digest, a stored HMAC offered
  as the legacy one, and the plain SHA-256 of a new link's secret all open
  nothing.
- **The Join page's hashing is on the server.** The key cannot go to a browser,
  so `fetchInvitePreview` posts the fragment to a new function, `invite-preview`,
  which needs no session (the page is shown before any prompt, spec §5.1),
  hashes it and calls `public.invite_preview`, now the service role's. It carries
  a per-address limit (120 an hour, the figure `redeem-invite` uses for an
  address) because it, unlike a stored digest, can be asked by anybody. The
  fragment travels in a request body only, as it already did to `redeem-invite`;
  the live e2e guard allows it to those two functions and nowhere else. The
  browser no longer hashes anything, which also removes the need for
  `expo-crypto` on native that the old comment promised.

### What each way of migrating means for links already shared

**Dual-read (built, the default).** Nothing already shared stops working.

- *Invite links.* An invite has **no expiry**: it is live until its owner resets
  it, so the lifetime of an old invite is the lifetime of the link in the chat.
  A `sha256` invite therefore stays openable, previewable and showable
  (`get-invite-link` still derives it) until its owner resets the link, which
  makes a new `hmac` one and kills the old. The old path cannot be dropped on a
  timer. It can be dropped once
  `select count(*) from circle_invites where digest_kind = 'sha256' and revoked_at is null`
  is zero, or once the founder decides to end it by sweeping the remainder (the
  other option below, run later and for fewer circles).
- *Emailed re-entry links.* Seven days from issue (`issue_reentry_token`'s
  `interval '7 days'`), single use. Every `sha256` re-entry token is expired
  **seven days after this ships**, so the legacy path can no longer move a membership
  from the eighth day and nothing is lost by removing it then. (Two lookups in
  `reattach_member_core` only decide which refusal to give, a saved account
  opening its own link and `target_is_permanent`, and do not look at
  `expires_at`; dropping the legacy path changes only what they say for an
  expired old token.)
- *The other email tokens* (verification, preferences, the three stop families)
  are not touched: they are not stored under this key and keep their SHA-256.

**Rotate every live link now (not built; the operator's sweep).** Every `sha256`
invite is replaced by an `hmac` one, with a new invite id and secret derived under
the existing `INVITE_LINK_KEY`, by `scripts/rotate-invite-key.mjs` pointed at the
key the project already has (and `INVITE_DIGEST_KEY`). The effect on links in
group chats is that **every one stops working at once** and the Join page says the
link is not active, until each circle's owner opens "Invite link" in the app and
re-shares the new one. Nothing announces this: it would be a message to every
owner by some other route, and it has to be sent on purpose. Emailed re-entry
links are not rotated by it (an email already sent cannot be reissued): the
sweep would have to expire them, and a guest with last week's letter would be
sent to Continue-as. This option makes the legacy path droppable immediately;
dual-read makes it droppable when the count above reaches zero or the founder
chooses the sweep then.

The follow-up that drops the legacy path (`p_legacy_hash` and
`p_legacy_token_hash` and their callers, the `sha256` branch of `get-invite-link`,
and the `sha256` rows) is **not** part of this change.

## Alternatives considered

- **Reuse `INVITE_LINK_KEY`.** One secret to set, but its documented rotation
  (the "invite key has leaked" runbook) would change every digest and end every
  link, and it is optional where this one must not be. Rejected for the reason
  in the Context.
- **Compute the HMAC in Postgres with a key in Vault.** The key would then sit in
  the database that the digest is meant to be unreproducible *without*, so a
  database copy that includes Vault is again enough. The ticket is explicit that
  the key never enters the database. Rejected.
- **Give the browser the key, or a derived "preview key".** A preview key is a
  second capability on every page, and anything in the bundle is public. Hashing
  stays on the server. Rejected.
- **Store SHA-256 of the HMAC, so a stored value is not itself the argument a
  service-role call takes.** This would stop a database copy *and* the service
  role key from replaying a stored digest into `redeem_invite`. But whoever holds
  the service role key can already read every circle and every membership
  (ADR 0028's consequence), so it closes a door nobody needs. Not done; noted in
  case the threat model changes.
- **Rotate on a schedule instead of dual-reading.** Ends the legacy path at a
  known date, at the cost the second option above describes. Left to the
  founder, because it is a message to owners and not a code change.

## Consequences

- **A copy of the tables cannot reproduce a stored digest**, and the Join page's
  browser-side hash is gone. Within the window, a `sha256` row remains exactly as
  recomputable as before; that is the price of not breaking links, and the count
  above measures it.
- **The key is a hard dependency, and has to be set before this deploys.**
  Without `INVITE_DIGEST_KEY`, creating or resetting a link, joining, previewing
  and coming back by an emailed link answer 503 (`create-circle` and
  `rotate-invite`, which charge an allowance, check the key first and charge
  nothing), and a letter that carries a re-entry link is **retried** by the
  dispatcher, with its backoff, until the key is set: an `Unavailable` from the
  token is treated like a provider having a bad minute, not as a failed letter.
  On a hosted
  project it is set with `make secret ENV=<dev|prod> K=INVITE_DIGEST_KEY`
  (an invented 32-byte value; that target runs `supabase secrets set` from an
  empty directory so the repository's `config.toml` secrets are not sent too).
- **It is not a rotating key.** Changing it makes every `hmac` digest stop
  matching, which ends every link made since; a leak is handled with the same
  sweep as above under the new key (the script takes both keys), not by setting
  a new value. The runbook says so.
- `invite_preview` leaves the `anon` role: a visitor's only way to the preview is
  the function, and its limit.
- The old `redeem_invite(uuid, bytea, text)`, `reattach_with_token(uuid, bytea)`,
  `invite_preview(bytea)`, `live_invite` (which now also returns `digest_kind`)
  and `private.reattach_member_core(…, bytea)` signatures are dropped, not left
  beside the new ones.
