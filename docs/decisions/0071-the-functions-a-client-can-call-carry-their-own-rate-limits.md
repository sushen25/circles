---
adr: 71
title: "The functions a client can call carry their own rate limits, and an address is sent one verification letter an hour"
status: proposed
date: 2026-10-15
builds_on: [19, 20, 49, 64]
---
# ADR 0071: The functions a client can call carry their own rate limits, and an address is sent one verification letter an hour

_Status: proposed · 15 October 2026 · builds on [ADR 0049](0049-continue-as-resolves-a-code-only-while-it-is-live.md), which put the first limit inside a function, and [ADR 0064](0064-join-limits-charge-the-person-asking-and-a-members-call-is-free.md), which set the rule for whom a limit charges_

## Context

The abuse limits (architecture §14) live in the Edge Functions. Most of the
functions behind them are granted to `authenticated`, so anybody signed in,
an anonymous guest included, can call them over `/rest/v1/rpc/` and never meet
a limit. What a direct caller skips is volume, not permission: every rule that
decides who may do a thing is in the database. But volume is the harm.

- `replace_response` bumps the plan's input version, writes an outbox row and
  can drop a `ready` plan back to `collecting`. Looped, it keeps the organiser's
  lock-in stale.
- `revise_plan` sends a `changed` letter to every subscriber on a material
  change, and `changed` is never collapsed. It had no limit even at the edge.
- `redeem_invite` fills a circle to its cap of twenty, `create_circle` and
  `create_plan` write rows without end, and `issue_invite`, `cancel_plan` and
  `confirm_meetup` write rows and events.
- Nothing bounded verification letters per destination address. The edge
  counters are per person and per connection, so a member with several of
  either could have a stranger's address mailed again and again, and every
  letter spends the sending domain's reputation. The absence of a per-address
  counter at the edge was deliberate (a counter keyed on the address is shared
  by everybody who can name it, and a refusal on a first attempt would tell the
  sender somebody else had asked), so the cap cannot be a refusal.

## Decision

**1. Each of those functions takes a token from `take_rate_token` itself**, ahead
of everything else it does, keyed on `auth.uid()` and, for the functions about
one plan, also on the caller and that plan. The size is well above the edge
limit, so the edge limit remains the one a person meets and the SQL one is the
backstop for a caller who skipped it.

| Function | Per caller an hour | Per caller and plan an hour | Edge limit it stands behind |
|---|---|---|---|
| `replace_response` | 600 | 300 | 120 per user |
| `redeem_invite` | 120 | | 30 per caller across links |
| `create_circle` | 60 | | 10 per user |
| `create_plan` | 200 | | 30 per user |
| `issue_invite` | 120 | | 20 per user (rotate) |
| `revise_plan` | 60 | 20 | none |
| `confirm_meetup` | 60 | 20 | none |
| `cancel_plan` | 60 | 20 | none |
| `rename_in_circle` | 120 | | 20 per user |

**2. A bucket is the caller's own.** No key is an id the caller names and
somebody else owns. The plan bucket is `caller:plan`, so naming another
person's plan spends the caller's allowance and never theirs, which is the rule
[ADR 0064](0064-join-limits-charge-the-person-asking-and-a-members-call-is-free.md)
set for joining. Nothing is keyed on an invite digest or a circle alone: either
would let anybody holding a leaked link, or the id of a circle, use up the
allowance of the people who belong there. The cost is that the per-caller
bucket does not stop one script minting fresh anonymous identities; the member
cap and the anonymous sign-in limit per address do.

**3. The limits count calls that complete.** The token is taken inside the
function's transaction, so a call that raises afterwards rolls its own count
back with everything else. That is the same as `reattach_member`'s limit
([ADR 0049](0049-continue-as-resolves-a-code-only-while-it-is-live.md)) and it
is what is wanted: a refused call does none of the work being limited.

**4. A verification letter goes to an address at most once an hour, silently.**
`request_email_updates` takes a token keyed on the address hash alone before it
enqueues a `verify_email` job, and when the token is refused it returns exactly
what an enqueued letter returns. The consent is still recorded. Nobody can tell
from any answer that the address was just asked about, which is the property
the endpoint's comment protects.

**5. Shape limits on what is stored.** `plans.cancel_note` is at most 280
characters, as every other note is. `circles.name` may not contain a control
character (a line break there reaches an email subject), `circles.color` is at
most 24 characters, and `circles.creation_key` at most 64. The last three are
added `not valid`: they apply to every new or changed row and do not re-read
the rows already there.

## Alternatives considered

- **Move these functions behind the service role.** Then the edge is the only
  door and the SQL needs no limit. It rewrites how every one of them finds the
  caller (`auth.uid()` is the actor, deliberately), and loses the property that
  a rule is enforced where it cannot be skipped. Rejected for now; it would be a
  bigger ticket than a backstop.
- **Per-circle or per-link buckets for `redeem_invite`.** They stop a leaked
  link filling a circle, but they are spent by everybody holding the link, so
  one person could lock out the rest. Admission is already bounded by the cap
  of twenty ([ADR 0012](0012-circle-member-cap-of-twenty.md)).
- **Count refusals too, in a separate transaction.** More faithful to
  `take_rate_token`'s "a refused attempt is still an attempt", at the price of
  an autonomous transaction per call. Not needed for what is limited here.
- **A per-address cap that refuses.** It would answer a second request
  differently from a first, which is the oracle the endpoint exists to avoid.
- **A sliding window.** Out of scope; every limit here is a fixed hourly bucket,
  so a burst can straddle an hour and see up to twice the size.

## Consequences

- A person who names a stranger's address uses up that address's hour: the
  stranger's own request inside it records consent and sends no letter, and
  they can ask again the next hour. A confirmed sign-in address is verified
  before the cap is reached, so an account holder's own address is unaffected.
- A bucket straddling the hour boundary can allow up to twice its size.
- Existing tests that ask twice for one address in one test now clear the
  counter between the two, as the clock moving on would.
- `circles.name`, `color` and `creation_key` have constraints that are not
  validated against old rows. Validating them is a one-line follow-up once the
  rows have been read.
