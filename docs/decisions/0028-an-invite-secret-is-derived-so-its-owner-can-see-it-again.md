# ADR 0028: An invite secret is derived, so its owner can see it again

_Status: accepted · 23 September 2026_

## Context

A circle's invite link is `/join#<secret>`: at least 256 bits in the URL
fragment, which no server sees, with only its SHA-256 stored (architecture
§14). `create-circle` returned the secret once, and S1-22 held it in memory for
the rest of the tab. After a reload the owner had no link, and the only way back
to one was resetting it — which kills the link already pasted in the group chat.

S1-23 asks for `get-invite-link`, "an owner-only Edge Function returning the
current secret", behind circle home's **Invite link** and settings' **Copy
link**. Under §14 as written there is no current secret to return: the database
has a digest, and a digest cannot be turned back into what was hashed. Returning
the secret means the server has to be able to produce it again, and there are
three ways to arrange that.

## Decision

**The secret is derived from the invite's id with a key the database never
holds**: `base64url(HMAC-SHA-256(INVITE_LINK_KEY, "circles.invite.v1:" + id))`.

- `create-circle` and `rotate-invite` choose the new invite's id, derive the
  secret, and pass the id and the secret's SHA-256 to `create_circle` /
  `issue_invite`. The database stores the digest and the id, as before.
- `get-invite-link` asks `public.live_invite` — the owner's alone — for the live
  invite's id and digest, derives the secret, and returns it **only if its
  digest is the one stored**. Anything else answers `null`: a link made before
  this ADR, or by a deployment without the key, or under a key since changed.
  The screen then offers a reset, which is the one honest way to a link nobody
  can show.
- `INVITE_LINK_KEY` is an Edge Function secret, set per project with
  `supabase secrets set INVITE_LINK_KEY=$(openssl rand -base64 32)`. Without
  it, links are made at random exactly as before and can only be reset.
- A read carries no idempotency key, so `get-invite-link` leaves no record
  holding the secret. `rotate-invite` is a mutation and its idempotency record
  keeps the response for the retry window — the exposure `create-circle`
  already accepts, for the same reason.

§14's invite row keeps every property it lists: ≥256-bit secret in the
fragment, SHA-256 stored, rotation invalidates immediately. It gains one: the
secret is reproducible by the Edge Functions and by nobody else.

## Alternatives considered

- **Store the secret encrypted** (a sealed column, key in the Edge Function).
  The same trust boundary as deriving it — the key and the database together
  give every live link — with a column to hold, migrate and forget to exclude
  from an export. Deriving needs nothing stored.
- **Store the secret in the clear**, in `private`. A copy of the database
  becomes a set of working links into every circle. §14 exists to prevent
  exactly that.
- **Keep "shown once", and make reset the way back** (S1-22's position). Every
  owner who reloads the tab then has to kill the link in the chat to invite one
  more friend, and non-owners who ask the owner for "the link" get a new one
  each time. It is also not what the ticket asks for.

## Consequences

- An attacker needs the database *and* the key to produce a working link. The
  key sits beside the service role key in the Edge Functions' secrets, and
  whoever holds the service role key can already read every circle, so this
  does not widen what one leaked secret gives away. It does mean **rotating
  `INVITE_LINK_KEY` makes every existing link unshowable** (they keep working;
  `get-invite-link` answers `null` until each owner resets).
- Invites made before this change, and every invite on a project where the key
  is unset, are resets-only. The app says so and offers the reset.
- The idempotency record of `rotate-invite` holds a readable secret for its
  retention window, like `create-circle`'s.
- `issue_invite` and `create_circle` take an optional invite id. An id chosen by
  a caller calling the RPC directly buys nothing: the secret is the key's to
  derive, so a digest of anything else is simply a link that cannot be shown.
