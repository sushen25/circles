# supabase/functions

Deno Edge Functions, one folder per use case (architecture §7.4). A pnpm
workspace member, so shared dev dependencies and the types for `npm:` imports
resolve from the root; the functions themselves reach `@circles/domain` and
`@circles/contracts` through [`import_map.json`](./import_map.json), which every
function's `deno.json` points at.

## What is here

| Folder                                  | What it does                                                                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| [`_shared/`](./_shared)                 | The kit every function is built from (S1-13)                                                                                          |
| [`redeem-invite/`](./redeem-invite)     | Join a circle from its link (spec §5.1)                                                                                               |
| [`reattach-member/`](./reattach-member) | "Continue as", and the emailed way back in ([ADR 0006](../../docs/decisions/0006-continue-as-reattachment-without-owner-approval.md)) |
| [`claim-identity/`](./claim-identity)   | Reconcile memberships when somebody saves their place (§10)                                                                           |
| [`hello/`](./hello)                     | The import-path smoke test from S0-06. Not a product endpoint                                                                         |

## The shape of a function

```ts
Deno.serve(
  jsonHandler({
    name: 'redeem-invite',
    schema: RedeemInviteRequest,
    handle: async ({ body, actor, caller }) => {
      /* … */
    },
  }),
);
```

`jsonHandler` does steps 1, 2 and 5 of §7.4 — parse with the contract's Zod
schema, verify the JWT and load the actor, claim the idempotency key, map
whatever goes wrong to a `Problem`, and echo `X-Request-Id`. What is left is the
use case.

## The two rules worth knowing before writing one

**Authorisation lives in the database.** A `security definer` function decides
who may do a thing; the Edge Function calls it through `caller`, the client that
carries the requester's own JWT, so `auth.uid()` is the person who asked and no
request body can change that. A check written in TypeScript is a check the next
function has to remember to write again — and one a client calling the RPC
directly never meets at all.

`service` bypasses RLS. It is for the kit's own bookkeeping (`begin_request`,
`take_rate_token`) and for `claim-identity`, whose authorisation is a second
access token that the database cannot see. Every other use wants a reason in a
comment.

**Rate limits and Turnstile are volume, not permission.** Skipping them lets
somebody make _more_ requests; it must never let them make a request the
database would have refused. Nothing in `_shared/rate.ts` or `turnstile.ts` is
ever the only thing standing between a caller and something they should not
have.

## Errors

Two levels, because a client needs both. `Problem.error` is the category that
picks the status; `Problem.reason` is the precise cause a screen turns on —
`invite_inactive` goes to LinkInvalid, `duplicate_name` asks for another name.
Branch on the reason, never on the message: the message is copy.

The database raises reasons by name (`raise exception 'duplicate_name'`) and
`_shared/problem.ts` is the one place a name becomes a status.

## What never leaves

Secrets are hashed before they are parameters: the invite fragment, the re-entry
token and the IP address behind a rate limit all reach the database as SHA-256
digests and never as themselves (§14). Logs are built from a fixed set of fields
rather than a template, so there is no interpolation site for a name or an
address — and a Postgres error message is never logged, because it can quote the
row that caused it. A SQLSTATE is.

## Running them

`pnpm db:start` serves them at `FUNCTIONS_URL` alongside the database.
`pnpm check` typechecks them (`tsconfig.functions.json`), lints the dependency
rule, runs the kit's unit suite, and — this is the one that catches a deploy
failure days early — checks that every bare import they make is in the import
map. Deno has no `node_modules`.
