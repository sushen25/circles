# ADR 0016: The idempotency key travels in the request body, not in a header

_Status: accepted · Date: 11 September 2026_

## Context

Architecture §9.1 said every function is "idempotent on a client-supplied
`Idempotency-Key`", capitalised the way a header is. S0-05 then shipped
`packages/contracts`, where every mutation's request schema extends

```ts
export const Mutation = z.object({ idempotency_key: IdempotencyKey });
```

— a field in the body. Twenty-odd request schemas carry it. So by the time the
first Edge Function came to read a key (S1-13), the architecture and the code
disagreed about where it was, and nothing had yet read one either way.

The disagreement is not cosmetic. Whichever place is right, the other has to be
*removed*: a key that may arrive in two places is two sources of truth for the
identity of a request, and the failure mode is a retry whose key the server
looks for in the wrong one and treats as a new request — which is exactly the
duplicate the key exists to prevent.

## Decision

**The key is `idempotency_key` in the request body**, validated by the request's
own Zod schema in `packages/contracts`. Architecture §9.1 is corrected to say
so. No function reads an `Idempotency-Key` header, and none should be added.

The reason is that the body is the only place both sides already validate. §7.4
step 1 is "parse the request with its Zod schema from `contracts`"; a key in the
body is inside that schema, so a client that omits it fails at the boundary with
every other malformed request, and a client written against the schema cannot
forget it. A header sits outside the contract, has to be validated separately in
every function, and is absent from the type a client builds against — so
"forgot the key" becomes a runtime behaviour difference rather than a compile
error.

## Alternatives considered

- **The header, as §9.1 implied.** It is the industry convention (Stripe's), it
  survives a body the server could not parse, and it reads naturally in a proxy
  log. Rejected because the convention's advantage — being outside the payload —
  is this codebase's disadvantage: the contract *is* the payload, and a key
  outside it is a key outside every guarantee the contracts package gives. The
  cost of switching was also asymmetric: the header needed a new validation path
  in the kit plus an edit to every schema that already has the field, against a
  one-line correction to the architecture.
- **Accept both, header first.** Rejected outright. That is the two-sources-of-
  truth failure above, with the added property that the bug only appears when a
  client sends a header and a body that disagree — which is to say, in
  production.
- **Derive the key from a digest of the body.** Attractive because it needs no
  client cooperation, and wrong: two deliberate identical requests (joining,
  leaving, joining again) are indistinguishable from a retry, so the second is
  silently swallowed.

## Consequences

- §9.1 reads "idempotent on a client-supplied `idempotency_key` in the request
  body"; the `Idempotency-Key` spelling is gone from the architecture.
- `_shared/http.ts` reads the key off the parsed body and needs no header
  handling. The fingerprint it stores is of the whole parsed body, so the key is
  covered by it too.
- `X-Request-Id` stays a header, and is unaffected: it identifies a *call* for a
  human to quote back, not a request for the server to deduplicate.
- A future non-JSON endpoint — a webhook with a provider-defined body, say —
  cannot carry the key this way. `email-provider-webhook` is the known case, and
  it is idempotent on the provider's message id instead (§13), which is better
  than a key the provider would never send.
