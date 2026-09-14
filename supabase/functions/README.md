# supabase/functions

Deno Edge Functions, one folder per use case (architecture §7.4). A pnpm
workspace member, so shared dev dependencies and the types for `npm:` imports
resolve from the root; the functions themselves reach `@circles/domain` and
`@circles/contracts` through [`import_map.json`](./import_map.json), which every
function's `deno.json` points at.

## What is here

| Folder                                                | What it does                                                                                                                                                |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`_shared/`](./_shared)                               | The kit every function is built from (S1-13)                                                                                                                |
| [`redeem-invite/`](./redeem-invite)                   | Join a circle from its link (spec §5.1)                                                                                                                     |
| [`reattach-member/`](./reattach-member)               | "Continue as", and the emailed way back in ([ADR 0006](../../docs/decisions/0006-continue-as-reattachment-without-owner-approval.md))                       |
| [`claim-identity/`](./claim-identity)                 | Reconcile memberships when somebody saves their place (§10)                                                                                                 |
| [`create-circle/`](./create-circle)                   | A circle and the link that fills it, in one transaction (§5.1)                                                                                              |
| [`create-plan/`](./create-plan)                       | A named plan, from a preset and the circle's defaults (§5.3)                                                                                                |
| [`revise-plan/`](./revise-plan)                       | Edit, adjust or reopen — and say first what it would cost ([ADR 0017](../../docs/decisions/0017-quorum-and-deadline-adjust-a-plan-without-a-revision.md))   |
| [`cancel-plan/`](./cancel-plan)                       | Call it off, with an optional note (§5.7)                                                                                                                   |
| [`submit-availability/`](./submit-availability)       | One member's answer, and the engine run in the same request ([ADR 0018](../../docs/decisions/0018-the-recalculation-runs-in-the-request-that-caused-it.md)) |
| [`recalculate-candidates/`](./recalculate-candidates) | The engine, for a plan with no request of its own. Internal                                                                                                 |
| [`confirm-meetup/`](./confirm-meetup)                 | The organiser locks a time in; it freezes there (§5.7)                                                                                                      |
| [`report-outcome/`](./report-outcome)                 | "Did this catch-up happen?", and "I was there" (§5.10)                                                                                                      |
| [`generate-ics/`](./generate-ics)                     | The confirmed meetup as a calendar file. A GET                                                                                                              |
| [`hello/`](./hello)                                   | The import-path smoke test from S0-06. Not a product endpoint                                                                                               |

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

Two other skeletons exist, for the two shapes that are not that one. Each keeps
the reference, the CORS headers, the PII-free log line and the `Problem`
mapping, and drops the steps that would be a lie for it:

| Wrapper                                    | For                                                                                                             |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| [`internalHandler`](./_shared/internal.ts) | A function no person calls. The bearer is `CRON_SECRET`, checked in constant time; no actor, no idempotency key |
| [`downloadHandler`](./_shared/download.ts) | A **GET** that answers with a file. Query string instead of a body; `Content-Disposition` instead of JSON       |

A mode on `jsonHandler` would have been worse than a second function: every step
that differs is a step it must _not_ take — `getUser` on a shared secret is a
round trip that can only fail, and an idempotency claim needs a user to belong
to.

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

## What is deliberately not a function

**Correcting your attendance before the meetup.** `going ↔ cant` from the
confirmed screen is an ordinary write to `public.attendance` through the
client's own session: `attendance_update_own` lets a person write their own row
and nobody else's, and `enforce_attendance_transition` holds the rules — not
before the meetup has ended for a retrospective answer, never back from an
answer about the past to a promise about the future, and the same answer twice
changes nothing (S1-10). A definer function would be a second authority over a
row the policy already governs, and the endpoint it sat behind would have to
re-derive what the trigger already knows.

`report-outcome` writes the _retrospective_ half — `was_there` / `missed` —
through the same policy for the same reason. It is an endpoint only because the
organiser's outcome, which is not a member's row at all, is the other half of
the same screen's work.

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
