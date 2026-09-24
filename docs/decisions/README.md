# Architecture decision records

Short records of decisions that shape the product or the code. A new ADR is required whenever a rule in the [spec](../mvp-product-spec.md) or the [architecture](../technical-architecture.md) changes. Numbering is sequential; superseded records stay in place with a status line.

| ADR | Decision | Status |
|---|---|---|
| [0001](./0001-eas-hosting-starter-server-output.md) | Host the web app on EAS Hosting Starter with Expo Router `server` output | accepted |
| [0002](./0002-stylesheet-with-generated-tokens.md) | `StyleSheet` with tokens generated from the design source | accepted |
| [0003](./0003-domain-events-via-postgres-outbox.md) | Domain events through a Postgres outbox drained by cron | accepted |
| [0004](./0004-organiser-requires-permanent-identity.md) | Organising requires a saved place; responding never does | accepted |
| [0005](./0005-willing-windows-retained-12-months.md) | Willing windows retained 12 months | accepted |
| [0006](./0006-continue-as-reattachment-without-owner-approval.md) | Continue-as reattachment without owner approval | accepted |
| [0007](./0007-pnpm-monorepo-with-shared-domain-package.md) | pnpm monorepo with a shared pure domain package | accepted |
| [0008](./0008-react-email-templates-in-edge-functions.md) | React Email templates rendered in Edge Functions | accepted |
| [0009](./0009-half-hour-availability-cells-with-a-scrolling-row.md) | Availability cells are half an hour each, and the day row scrolls | accepted |
| [0010](./0010-tonight-deadline-gives-up-its-margin.md) | Tonight's deadline gives up its margin rather than the plan | accepted |
| [0011](./0011-near-misses-need-someone.md) | A near-miss needs someone, unless nobody is anywhere | accepted |
| [0012](./0012-circle-member-cap-of-twenty.md) | A circle holds up to twenty active members | accepted |
| [0013](./0013-availability-written-only-through-replace-response.md) | A member's availability is written only through `replace_response` | accepted |
| [0014](./0014-retention-runs-in-the-database.md) | Retention runs in the database from pg_cron, not in the dispatcher | accepted |
| [0015](./0015-sql-functions-live-in-one-file-each.md) | A database function's definition lives in one file, generated into migrations | accepted |
| [0016](./0016-idempotency-key-travels-in-the-request-body.md) | The idempotency key travels in the request body, not in a header | accepted |
| [0017](./0017-quorum-and-deadline-adjust-a-plan-without-a-revision.md) | Changing a quorum or a deadline adjusts a plan; it does not revise it | accepted |
| [0018](./0018-the-recalculation-runs-in-the-request-that-caused-it.md) | The recalculation runs in the request that caused it | accepted |
| [0019](./0019-consent-is-recorded-when-it-is-given.md) | Consent is recorded when it is given, and a preferences link does not expire on use | accepted |
| [0020](./0020-the-verification-token-is-minted-by-the-sender.md) | The verification token is minted by whoever sends the email | accepted |
| [0021](./0021-the-link-preview-is-not-rate-limited.md) | The link preview is not rate-limited; the code space is the control | accepted |
| [0022](./0022-a-plan-link-admits-new-members-while-the-plan-is-asking.md) | A plan link admits new members while the plan is taking answers | accepted (one point narrowed by 0026) |
| [0023](./0023-emailed-tokens-travel-in-the-fragment.md) | Emailed tokens travel in the URL fragment, never the path | accepted |
| [0024](./0024-availability-days-first-then-a-time-once.md) | Availability is answered days first, then a time once | accepted |
| [0025](./0025-the-preferences-link-is-minted-with-each-email.md) | The preferences link is minted with each email, and both footer links open it | accepted (organiser-email question answered by 0029) |
| [0026](./0026-first-run-shares-a-plan-and-a-defaulted-quorum-follows-the-circle.md) | First run shares a plan, not an invite, and a defaulted quorum follows the circle | accepted |
| [0027](./0027-the-organisers-auth-address-is-an-email-contact.md) | The organiser's auth address is an email contact, verified by auth | accepted |
| [0028](./0028-an-invite-secret-is-derived-so-its-owner-can-see-it-again.md) | An invite secret is derived, so its owner can see it again | accepted |
| [0029](./0029-an-organiser-turns-organiser-email-off-in-the-app.md) | An organiser turns organiser email off in the app, not by a link | accepted |
| [0030](./0030-a-plan-may-ask-about-up-to-thirty-days.md) | A plan may ask about up to thirty days | accepted |
| [0031](./0031-a-meetup-may-last-up-to-five-hours.md) | A meetup may last up to five hours | accepted |
| [0032](./0032-the-circles-zone-is-shown-when-the-readers-device-differs.md) | The circle's zone is shown when the reader's device differs, not when a member's does | accepted |

## Template

```markdown
# ADR NNNN: Title

_Status: proposed | accepted | superseded by NNNN · Date_

## Context
## Decision
## Alternatives considered
## Consequences
```
