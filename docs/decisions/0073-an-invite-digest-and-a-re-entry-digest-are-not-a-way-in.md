---
adr: 73
title: "A stored invite or re-entry digest is not a way in: the functions that take one are the service role's"
status: accepted
date: 2026-10-15
amends: [71]
builds_on: [28, 49]
amended_by: [82]
---
# ADR 0073: A stored invite or re-entry digest is not a way in: the functions that take one are the service role's

_Status: accepted · 15 October 2026 · amends [ADR 0071](0071-the-functions-a-client-can-call-carry-their-own-rate-limits.md) for `redeem_invite`, and builds on [ADR 0028](0028-an-invite-secret-is-derived-so-its-owner-can-see-it-again.md), which stores only a digest so that a copy of the database is not a set of working links, [ADR 0049](0049-continue-as-resolves-a-code-only-while-it-is-live.md), which defined the emailed re-entry path_

## Context

ADR 0028 stores the SHA-256 of an invite secret, not the secret, and
architecture §14 stores the SHA-256 of a re-entry token, because "a copy of the
database becomes a set of working links into every circle" if it holds the
secrets. But `redeem_invite(p_secret_hash, …)` and
`reattach_member(…, p_reentry_token_hash)` were granted to `authenticated` and
take that digest. Anybody holding a copy of `circle_invites` or
`email_action_tokens` (a backup, an export, a read-only SQL user) could sign in
anonymously and call either over `/rest/v1/rpc/` with a stored digest: join any
circle, or take over a guest's place with an unspent link, and in one case take
it back from a saved account (ADR 0049, decision 6). The storage decision
protected nothing a grant had given away. `live_invite` also returned the
current digest to the owner's client, which has no use for it.

(That the digest names one invite across circles is migration 0044's unique
constraint, already in place. It is tested again in `480_invite_digest_is_not_a_credential.sql`.)

## Decision

The three functions that take or return a digest belong to the service role and
are called only by their Edge Functions, in the shape `join_from_plan` and
`claim_identity` already have: the function receives the person as a parameter,
and the Edge Function takes that person from the verified JWT, never from a
request body.

- `redeem_invite(p_user_id, p_secret_hash, p_display_name)`: the `redeem-invite`
  function hashes the fragment secret and calls it with `actor.userId`.
- `reattach_with_token(p_user_id, p_reentry_token_hash)`: the token form,
  split out of `reattach_member`. `reattach_member(p_circle_id, p_target_user_id)`
  keeps the Continue-as list form for `authenticated`; both call one body,
  `private.reattach_member_core`, so there is still one list of safeguards.
- `live_invite(p_circle_id, p_user_id)`: `get-invite-link` calls it with the
  owner it verified, and the digest stops at the server.

The `authenticated` grants are revoked and the pgTAP allow-lists say so.

**The per-person limit travels with the person.** ADR 0071's bucket inside
`redeem_invite` is keyed on `p_user_id`. Only the service role can name that id,
and the Edge Function takes it from the JWT, so no client can spend somebody
else's allowance by naming them: the rule from ADR 0064 and ADR 0071 holds.
The token path had no per-person bucket (it is the rightful member's way back
and is deliberately not throttled by volume), and the list path keeps its
per-circle bucket as before.

**One check cannot follow the call.** `reattach_member` read the JWT's
`is_anonymous` claim as one of three records that the caller is a saved
account. For the service role the JWT is not the person's. The token form
therefore relies on the other two, `profiles.is_permanent` and
`auth.users.is_anonymous`, which are read live and are never stale; the claim
was only ever the weakest of the three, wrong for the hour after
`linkIdentity`.

## Alternatives considered

- **Take the preimage and hash in SQL (`redeem_invite(p_secret, …)`)**, so a
  stored digest is useless because the function wants the secret. Rejected:
  it makes the capability a statement parameter. Architecture §14 hashes the
  secret in the Edge Function precisely so that it never appears in a query
  log, `pg_stat_statements`, or an error context. The service-role shape needs
  no preimage in SQL and keeps the secret out of every statement.
- **An HMAC of the secret under a server key**, so a copy of the tables is
  useless even to a service-role caller who lacks the key. A good second layer,
  but it changes every stored digest (a migration over live data, a key to
  hold and rotate, and a lookup by digest that the Join page also does from the
  browser). Left as a follow-up; it does not replace removing the grant.
- **Keep the grant and add a check that the caller could have known the
  secret.** There is nothing to check: the only evidence of knowing it is the
  secret.
- **Leave `live_invite` with `authenticated`.** The digest is no longer a
  working credential, so this would be harmless, but a client gets nothing from
  it and every value that reaches a client is a value that can leak from one.

## Consequences

- A copy of `circle_invites` or `email_action_tokens` is not enough to join a
  circle or move a membership. A leaked *service key* still is, as it is for
  every other service-role function.
- Anything that called these over RPC with a user session must go through the
  Edge Function. The app already does; pgTAP calls them through a helper that
  becomes the service role for the call.
- `invite_preview` stays `anon` (changed by [ADR 0082](0082-invite-and-re-entry-digests-are-an-hmac-under-a-key-only-the-functions-hold.md): the digest is an HMAC a browser cannot compute, so it is the service role's behind `invite-preview`), keyed by the digest, and returns the least the
  Join page draws; a digest names a preview and nothing else.
- Done since: an HMAC under a server key for both digests, [ADR 0082](0082-invite-and-re-entry-digests-are-an-hmac-under-a-key-only-the-functions-hold.md). Still open: the
  readable invite secret in `rotate-invite`'s idempotency record for seven days,
  which ADR 0028 accepted.
