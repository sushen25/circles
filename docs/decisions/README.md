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

## Template

```markdown
# ADR NNNN: Title

_Status: proposed | accepted | superseded by NNNN · Date_

## Context
## Decision
## Alternatives considered
## Consequences
```
