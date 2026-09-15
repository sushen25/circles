# ADR 0021: The link preview is not rate-limited; the code space is the control

_Status: accepted · Date: 15 September 2026_

## Context

Architecture §9.4 described the link-preview route as reading the circle's name
"via a public, rate-limited definer function keyed by short code", and S1-21's
ticket asked for "60/min per IP in the function". Neither is implemented, and
the wording was not implementable as written.

A `security definer` function called as `anon` has no caller to count. There is
no `auth.uid()`, and an IP address is not something Postgres can see: it reaches
the database only if some caller passes it in, at which point the limit counts
whatever the caller says it is. The counting would have to happen above, in the
web server that serves the card.

That server cannot do it either, at least not cheaply. `public.take_rate_token`
is `service_role` only, and deliberately: it writes `jobs.rate_counters`, which
is how every other limit in the product is enforced. Giving the Expo web server
a service-role key so that it can count link previews would put the key that
bypasses RLS into the one process that answers unauthenticated strangers — a
much larger risk than the one being mitigated.

## Decision

**The preview is not rate-limited, and the short-code space is what stands in
the way of enumeration.**

A plan short code is eight characters from a 31-letter alphabet (`i`, `l`, `o`,
`0` and `1` are excluded), which is about 8.5 × 10¹¹ codes. Walking it to
harvest circle names is not a practical attack, and the prize is a circle's
name — which is already rendered into every group chat the link is pasted into,
to everybody in that chat, by design (§5.2).

What actually protects the endpoint is what it can say. `preview_for_code`
returns one `text`: a circle's name for a live plan code, and `null` for
everything else — an unknown code, an archived circle, a malformed code, and
`/join`, whose secret lives in a fragment no server ever receives. There is no
field for anything else to be added to, which is a stronger and more durable
property than a counter.

Architecture §9.4 is corrected to say this.

## Alternatives considered

- **Count in the database against a passed-in address.** Rejected: a limit
  whose key the caller chooses is not a limit, and it would put an IP address —
  which is a person — into a table for no benefit.
- **Give the web server the service-role key.** Rejected for the reason above:
  the blast radius of that key in that process is far larger than unmetered
  reads of a public name.
- **Cache the card at the edge and call it a limit.** Rejected, and then
  ruled out entirely: the card is served at the URL people tap, and an edge
  cache there hands a person the card instead of the app. Every preview
  response is `no-store`, and so is the page HTML beside it — so there is no
  caching here to mistake for a limit.

## A second thing this settles: `/join` has no named card

Spec §5.1 said the invite's chat preview "shows the circle name". It cannot.
`/join#<secret>` carries its secret in the fragment, and a fragment is never
sent to a server — so the route that draws the card cannot know which circle
the link is for, and `preview_for_code` refuses that kind outright rather than
pretending.

The generic card is what an invite gets: "Pick the times you'd actually be up
for. No app needed." A plan link (`/j/<code>`, `/p/<code>`) carries a code in
the path and is named. §5.1 is corrected to say both.

This is not a loss worth engineering around. Putting the circle in the path
would mean a link that names the circle to anybody who sees the URL, in a chat
the invite may be forwarded well beyond — and the whole reason the secret is in
a fragment is that the server never needs it.

## Consequences

- An attacker with a list of valid plan codes can read those circles' names.
  They could equally read them by being in any chat the links were pasted into.
- If the code space ever shortens, or the preview ever answers with more than a
  name, this decision has to be revisited — both are the kind of change that
  should be hard to make accidentally, and the function's signature is what
  makes the second one hard.
- The rate limits that exist stay where they are enforceable: on the endpoints
  that write (`jobs.rate_counters`, via `take_rate_token`), reached only by the
  service role.
