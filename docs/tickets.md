# Circles MVP — ticket index

Linear project **Circles MVP** (team Sushen). Ticket bodies cross-reference each other by S-number; this table maps S-numbers to Linear ids. Milestones are the delivery slices from [the spec](./mvp-product-spec.md) §15. Every ticket names the spec/architecture sections and the `docs/design/` artboards it implements.

| S | Linear | Title |
|---|---|---|
| S0-01 | SUS-6 | Monorepo scaffold: pnpm workspaces, TypeScript, lint boundaries, `pnpm check` |
| S0-02 | SUS-7 | Expo app scaffold: SDK 57, Expo Router, `server` web output, EAS project, brand config |
| S0-03 | SUS-8 | Design tokens package generated from `docs/design/gen.py`, fonts bundled |
| S0-04 | SUS-9 | Component library matching the Components artboard |
| S0-05 | SUS-10 | Contracts package: Zod schemas, analytics catalogue, copy package with lint rules |
| S0-06 | SUS-11 | Supabase local stack: config, schemas, pgTAP, type generation, import map |
| S0-07 | SUS-12 | Domain foundations: Instant, LocalDate, Zone, Interval, Result, clock, fixtures |
| S0-08 | SUS-13 | Route skeleton with fixture screens (clickable flow, no backend) |
| S0-09 | SUS-14 | CI: GitHub Actions, EAS Workflows, PR previews |
| S0-10 | SUS-15 | `AGENTS.md`, README, runbook skeleton |
| S0-11 | SUS-16 | Environments and vendors: Supabase dev/prod, EAS Starter + domain, DNS, Resend, Turnstile, secrets |
| S1-01 | SUS-17 | Domain · circles |
| S1-02 | SUS-18 | Domain · planning (state machine, presets, deadlines) |
| S1-03 | SUS-19 | Domain · availability |
| S1-04 | SUS-20 | Domain · scheduling (candidate engine) |
| S1-05 | SUS-21 | Domain · confirmation and outcomes, ICS |
| S1-06 | SUS-22 | Domain · communication (kinds, eligibility, idempotency, quiet hours, share messages) |
| S1-07 | SUS-23 | Database · identity and circles, RLS |
| S1-08 | SUS-24 | Database · planning, `transition_plan()` |
| S1-09 | SUS-25 | Database · availability and scheduling |
| S1-10 | SUS-26 | Database · confirmation and outcomes |
| S1-11 | SUS-27 | Database · communication (private), jobs, analytics |
| S1-12 | SUS-28 | Database · cron, retention, seed scenarios |
| S1-12b | SUS-74 | Database · one home per SQL function (ADR 0015) |
| S1-13 | SUS-29 | Edge Functions kit + `redeem-invite`, `reattach-member`, `claim-identity` |
| S1-14 | SUS-30 | Client auth module (email code, anonymous, linking, guards) |
| S1-14b | SUS-77 | Apple and Google sign-in: providers, OAuth clients, Supabase providers |
| S1-15 | SUS-31 | `create-circle`, `create-plan`, `revise-plan`, `cancel-plan` |
| S1-16 | SUS-32 | `submit-availability`, `recalculate-candidates` |
| S1-17 | SUS-33 | `confirm-meetup`, `report-outcome`, `generate-ics` |
| S1-18 | SUS-34 | Email functions: request, verify, preferences, re-entry tokens |
| S1-19 | SUS-35 | Resend client, React Email templates, provider webhook |
| S1-20 | SUS-36 | `process-scheduled-jobs` dispatcher |
| S1-21 | SUS-37 | `track-events`, analytics views, OG link-preview route |
| S1-22 | SUS-38 | Client · first-time organiser flow |
| S1-23 | SUS-39 | Client · circles list, create, circle home, settings, account, privacy, notifications |
| S1-24 | SUS-40 | Client · guest join, Continue-as, invite inactive |
| S1-25 | SUS-41 | Client · availability editor |
| S1-26 | SUS-42 | Client · plan setup, custom window, edit, change time, cancel |
| S1-27 | SUS-43 | Client · candidates, waiting, no quorum |
| S1-28 | SUS-44 | Client · confirm review, confirmed screens, share, add to calendar |
| S1-29 | SUS-45 | Client · outcome and attendance |
| S1-30 | SUS-46 | Client · sent, check email, verified, preferences, save access |
| S1-31 | SUS-47 | Web e2e suite (incl. in-app-browser UAs) |
| S1-32 | SUS-48 | Slice 1 release and founder dogfood |
| S2-01 | SUS-49 | Domain · quiet ask |
| S2-02 | SUS-50 | Backend · quiet ask functions and expiry |
| S2-03 | SUS-51 | Client · quiet ask screens |
| S2-04 | SUS-52 | Cadence, nudge policy, plan another |
| S2-05 | SUS-53 | Replies closed: hand-off, extend, lock in |
| S2-06 | SUS-54 | Tonight/weekend presets, day-part pre-fill |
| S2-07 | SUS-55 | Guest → saved place prompts, organiser gate, `record-nudge` |
| S2-08 | SUS-56 | Slice 2 e2e and release |
| S3-01 | SUS-57 | Native delivery, universal links, `app_installed_at` |
| S3-02 | SUS-58 | Calendar overlay and native add-to-calendar |
| S3-03 | SUS-59 | Push |
| S3-04 | SUS-60 | Guest → app prompts |
| S3-05 | SUS-61 | Sentry, Maestro, Slice 3 release |
| S4-01 | SUS-62 | Abuse and rate limiting |
| S4-02 | SUS-63 | RLS and privacy audit |
| S4-03 | SUS-64 | Accessibility pass |
| S4-04 | SUS-65 | Time-zone and DST matrix |
| S4-05 | SUS-66 | Privacy pages, terms, deletion, export |
| S4-06 | SUS-67 | Founder diagnostics, runbooks, Supabase Pro |
| S4-07 | SUS-68 | External cohort readiness and go/no-go |

## Working a ticket

The process, and the rules that came out of getting it wrong, are in
[`working-process.md`](./working-process.md). In short:

1. Read `AGENTS.md`, then the ticket's "Read first" list (spec/architecture sections and artboards).
2. Check the ticket's blockers are done (Linear shows them).
3. Branch from `main` using Linear's branch name; keep the PR to the ticket's scope; note anything the ticket asked you to decide in a PR comment and in the ticket.
4. `pnpm check` green; definition of done (spec §16) satisfied; move the ticket to In Review with the PR link.
