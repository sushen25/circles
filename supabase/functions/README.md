# supabase/functions

Deno Edge Functions, one folder per use case (architecture §7.4). A pnpm
workspace member, so shared dev dependencies and the types for `npm:` imports
resolve from the root; the functions themselves reach `@circles/domain` and
`@circles/contracts` through [`import_map.json`](./import_map.json), which every
function's `deno.json` points at.

## What is here

| Folder                                                    | What it does                                                                                                                                                                                              |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`_shared/`](./_shared)                                   | The kit every function is built from (S1-13)                                                                                                                                                              |
| [`redeem-invite/`](./redeem-invite)                       | Join a circle from its link (spec §5.1)                                                                                                                                                                   |
| [`join-plan/`](./join-plan)                               | Join a circle from a plan's link, while it is taking answers ([ADR 0022](../../docs/decisions/0022-a-plan-link-admits-new-members-while-the-plan-is-asking.md))                                           |
| [`reattach-member/`](./reattach-member)                   | "Continue as", and the emailed way back in ([ADR 0006](../../docs/decisions/0006-continue-as-reattachment-without-owner-approval.md))                                                                     |
| [`claim-identity/`](./claim-identity)                     | Reconcile memberships when somebody saves their place (§10)                                                                                                                                               |
| [`create-circle/`](./create-circle)                       | A circle and the link that fills it, in one transaction (§5.1)                                                                                                                                            |
| [`create-plan/`](./create-plan)                           | A named plan, from a preset and the circle's defaults (§5.3)                                                                                                                                              |
| [`revise-plan/`](./revise-plan)                           | Edit, adjust or reopen — and say first what it would cost ([ADR 0017](../../docs/decisions/0017-quorum-and-deadline-adjust-a-plan-without-a-revision.md))                                                 |
| [`cancel-plan/`](./cancel-plan)                           | Call it off, with an optional note (§5.7)                                                                                                                                                                 |
| [`hand-off-organiser/`](./hand-off-organiser)             | "Hand this to someone else": the plan to another member it asks with a saved place; the old organiser's queued letters taken back (§5.7)                                                                  |
| [`extend-deadline/`](./extend-deadline)                   | "Give it one more day", once per revision, never past half an hour before the last start (§5.7)                                                                                                           |
| [`submit-availability/`](./submit-availability)           | One member's answer, and the engine run in the same request ([ADR 0018](../../docs/decisions/0018-the-recalculation-runs-in-the-request-that-caused-it.md))                                               |
| [`recalculate-candidates/`](./recalculate-candidates)     | The engine, for a plan with no request of its own. Internal                                                                                                                                               |
| [`confirm-meetup/`](./confirm-meetup)                     | The organiser locks a time in; it freezes there (§5.7)                                                                                                                                                    |
| [`report-outcome/`](./report-outcome)                     | "Did this catch-up happen?", and "I was there" (§5.10)                                                                                                                                                    |
| [`record-nudge/`](./record-nudge)                         | A conversion prompt: may it be shown, and what was done with it (§5.11). Caps from the domain                                                                                                             |
| [`generate-ics/`](./generate-ics)                         | The confirmed meetup as a calendar file. A GET                                                                                                                                                            |
| [`request-email-updates/`](./request-email-updates)       | "Email me about this meetup", per plan and verified (§5.8)                                                                                                                                                |
| [`verify-email-contact/`](./verify-email-contact)         | The link in the verification email. No session                                                                                                                                                            |
| [`manage-email-preferences/`](./manage-email-preferences) | Stopping it, with no sign-in. No session                                                                                                                                                                  |
| [`email-provider-webhook/`](./email-provider-webhook)     | Resend's delivery events: a hard bounce or a complaint suppresses the address. Signed by the provider, not a session                                                                                      |
| [`process-scheduled-jobs/`](./process-scheduled-jobs)     | The one background worker: outbox → notification jobs → email, plus deadlines, expiry and the daily health summary ([ADR 0003](../../docs/decisions/0003-domain-events-via-postgres-outbox.md)). Internal |
| [`hello/`](./hello)                                       | The import-path smoke test from S0-06. Not a product endpoint                                                                                                                                             |

## Email

[`_shared/email/`](./_shared/email) is everything that turns a job into a
letter, and nothing that decides whether to send one (that is S1-20's
dispatcher, and the domain's rules):

- `render(input)` → `{ subject, html, text, headers }` for every emailed kind,
  from React Email templates (ADR 0008). The input carries ids, values and
  **tokens already minted for this letter** — `issueVerificationToken`,
  `issuePreferencesToken`, `issueReentryToken` in `_shared/tokens.ts`, each for
  the job's contact (ADR 0020, ADR 0025). Links are built by the contract's
  functions, so a token can only ever sit after the `#` (ADR 0023).
- `sendEmail(message, context)` → the provider's message id, or an
  `EmailSendError` with a code and nothing the provider said. Mailpit when
  `EMAIL_CAPTURE_URL` is set (every local stack), Resend when
  `RESEND_API_KEY` is, `email_unconfigured` otherwise (`dev`).
- The copy is in `copy.ts`, beside the templates, and the snapshots of every
  email against the Sunday Crew are in `__snapshots__/` — open a `.html` in a
  browser, or run `pnpm email:preview` to have them all in Mailpit.

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

| Wrapper                                    | For                                                                                                                   |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| [`internalHandler`](./_shared/internal.ts) | A function no person calls. The bearer is `CRON_SECRET`, checked in constant time; no actor, no idempotency key       |
| [`downloadHandler`](./_shared/download.ts) | A **GET** that answers with a file. Query string instead of a body; `Content-Disposition` instead of JSON             |
| [`linkHandler`](./_shared/link.ts)         | A function a **link** authorises. No actor at all: the token in the body is ≥256 bits and the whole of the permission |

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

## Two other things that are deliberately not a function

**An address never leaves.** `private.email_contacts` is the only table that
holds one, and nothing above it returns one: not a DTO, not a log line, not an
analytics payload, not a `Problem`. `request-email-updates` answers
`{ status: 'check_email' }` whether the address was new, already verified, held
by somebody else or suppressed after a bounce — because four different answers
would let a member walk a list of addresses through a plan and learn which of
their friends use the product.

**A token is minted here and stored as a digest.** `_shared/tokens.ts` generates
32 bytes and passes the SHA-256; the readable form exists in the request that
made it and in the email, and nowhere else. A token generated in SQL would have
been a statement parameter, and statement parameters end up in logs.

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
