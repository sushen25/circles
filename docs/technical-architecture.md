# Circles — technical architecture

_Status: proposed, v1_

_Date: 6 September 2026_

_Inputs: [MVP product spec](./initial-mvp-product-spec.md) §12–16, [spec review](./mvp-spec-review.md) and the founder's decisions in its §8, [guest → app flow](./guest-to-app-flow.md), [design manifesto](./design-manifesto.md), and the "Circles MVP UI" canvas (source in `docs/design/`)._

_Codename: **Circles** (placeholder). Nothing in code, domains or store metadata should assume the final name; see §5.4._

## 1. What this document decides

This is the implementation blueprint for the MVP as revised: web-first no-install participation, a persistent private circle, named plans and quiet asks, a deterministic candidate engine with quorum, human confirmation, an outcome loop, and a considered guest → account → app path. It fixes the infrastructure, the stack, the domain model, the code organisation, the data model, the security boundaries, the testing strategy and the delivery order. Where a choice is a judgement call it is marked **ADR** and should be recorded in `docs/decisions/` when adopted.

Decisions inherited from the spec and review and not reopened here: Expo universal app over a separate web app; Supabase over Firebase or a custom API; Resend as the only email vendor; local-only device-calendar processing; no chat, discovery, payments, or LLM scheduling in MVP; the re-sequenced slices (web end-to-end → relationship loop on web → native → hardening).

## 2. Architecture goals, in priority order

1. **One real group can complete a meetup on Slice 1 with nothing installed.** Everything else waits for that.
2. **The domain is legible.** A coding agent or a new engineer can read `packages/domain` and know every rule the product enforces, without reading a screen or a migration.
3. **Privacy invariants are structural, not procedural.** Raw calendar events cannot reach the network, quiet-ask identities cannot be selected, and email addresses cannot be read by a client, because the code and the database make it impossible rather than because someone remembered.
4. **Near-zero fixed cost during validation**, with a clean upgrade path (Supabase Pro, EAS Production) when a non-founder cohort arrives.
5. **Idempotent, reproducible operations.** Every mutation is safe to retry; every environment can be rebuilt from the repository.
6. **No premature services.** One repository, one language, one database, one hosted backend.

## 3. System overview

```text
                  Group chat (WhatsApp, iMessage, Messenger)
                               │  link with #fragment secret
                               ▼
   ┌──────────────────────────────────────────────────────────────┐
   │  Expo universal app (Expo Router, React Native, TypeScript)  │
   │                                                              │
   │  web (server output on EAS Hosting, custom domain)           │
   │   · guest routes: /join, /p/:plan, /a#token, /e#token        │
   │   · organiser routes: /circles, /circles/:id, …              │
   │   · +api routes: OG tags for link previews only              │
   │                                                              │
   │  iOS / Android (EAS builds, universal links)                 │
   │   · same routes + calendar overlay, push, add-to-calendar    │
   └───────────────┬──────────────────────────────┬───────────────┘
                   │ supabase-js (anon key + JWT)  │ https (Edge Functions)
                   ▼                               ▼
   ┌──────────────────────────────────────────────────────────────┐
   │  Supabase project                                            │
   │  Auth: email OTP · Apple · Google · anonymous                │
   │  Postgres: public (RLS) · private (no API) · analytics       │
   │  Edge Functions: task endpoints (Deno/TS, share domain pkg)  │
   │  pg_cron + pg_net: scheduled jobs → functions                │
   │  Storage: none in MVP                                        │
   └──────┬──────────────────────────┬────────────────────┬───────┘
          │                          │                    │
          ▼                          ▼                    ▼
   Expo Push Service          Resend (email API      Cloudflare Turnstile
   → APNs / FCM               + signed webhooks)     (anonymous joins)
```

There is no queue vendor, cache, search engine, analytics SaaS, CMS, map provider, AI inference, or separate Node server.

## 4. Technology stack

| Layer | Choice | Version policy | Why |
|---|---|---|---|
| Language | TypeScript, strict, everywhere (client, domain, Edge Functions, scripts) | TS 5.x | One language for humans and agents; domain package shared verbatim between client and server |
| Client framework | Expo SDK 57, React Native 0.86, React 19.2, Expo Router | Track latest stable SDK; upgrade once per quarter | Universal iOS/Android/web from one codebase; file-based routes mirror the screen inventory |
| Web output | `web.output: "server"` | — | Needed for per-link Open Graph tags (review 6.7); everything else is client-rendered |
| Web hosting | EAS Hosting, **Starter plan** (US$19/month) | — | Custom domain is paid-only on EAS; Starter is the cheapest plan that gives one **ADR-001** |
| Native delivery | EAS Build (development builds), EAS Update, TestFlight, Play internal testing | — | Calendar and push modules need development builds; Expo Go is not a target |
| Styling | React Native `StyleSheet` + a tokens package generated from the design manifesto; no Tailwind/NativeWind | — | Keeps the token vocabulary identical to `docs/design/gen.py`; fewer moving parts on web **ADR-002** |
| Fonts | `expo-font` bundling Newsreader and Figtree; metric-compatible fallbacks | — | Manifesto §5.2 |
| Data fetching | TanStack Query v5 over `supabase-js` | — | Cache, optimistic updates, offline draft retry |
| Local storage | `expo-secure-store` (session on native), `localStorage` (web), MMKV for availability drafts | — | Offline availability editing (manifesto §7.6) |
| Validation | Zod for every function request/response, DTO, deep-link payload and analytics event | — | Runtime contracts at every boundary |
| Backend | Supabase hosted project: Postgres 15+, Auth, Edge Functions (Deno), pg_cron, pg_net | — | Relational domain, RLS isolation, generated types, migrations |
| Push | `expo-notifications` + Expo Push Service | — | Free, one API over APNs/FCM |
| Email | Resend via Edge Functions only; Resend webhooks for delivery events | — | 3,000/month free is ample for validation |
| Bot protection | Cloudflare Turnstile on anonymous join (invisible mode) | — | Supabase's recommendation for anonymous sign-ins |
| Calendar | `expo-calendar`, adapter-isolated | — | Local-only reads; native only |
| Testing | Vitest (domain, application), pgTAP (database, RLS), Playwright (web e2e in real in-app-browser UAs), Maestro (native e2e), Supabase CLI local stack | — | Each layer testable in CI without secrets |
| CI/CD | GitHub Actions; EAS Workflows for builds/updates | — | One `pnpm check` command mirrors CI locally |
| Package manager | pnpm workspaces | — | Monorepo with strict boundaries |
| Errors/monitoring | Structured logs + Supabase logs during private beta; Sentry (`@sentry/react-native`) before the external cohort | — | Spec §12.2 |
| Analytics | First-party `analytics.events` table + SQL views | — | No vendor; definitions live next to the code |

## 5. Infrastructure and environments

### 5.1 Environments

| Environment | Supabase | Web | Native | Purpose |
|---|---|---|---|---|
| `local` | Supabase CLI stack in Docker (`supabase start`), seeded | `expo start` (Metro) | Development build on device/simulator pointed at local or `dev` | Everyday development; every test suite runs here |
| `dev` | Hosted project `circles-dev` (Free) | EAS Hosting preview deployments per PR | Development builds, EAS Update `dev` channel | Integration testing, agent PR previews |
| `prod` | Hosted project `circles-prod` (Free during founder cohort → **Pro** before the external cohort) | EAS Hosting production on the custom domain | TestFlight / Play internal → store listings later | The real groups |

Free projects pause after seven days of inactivity; a pg_cron heartbeat job does not prevent this. `prod` moves to Pro (US$25/month, spend cap on) the week the first non-founder circle is recruited, for backups and no pausing.

### 5.2 Domains and DNS

- App and links: `circles.app` is a placeholder; the real domain is chosen with the name (branding research §10). Until then use a neutral holding domain owned by the founder; **never** ship links on `*.expo.app`.
- Routes reserved on the domain: `/join#<secret>` (circle invite), `/j/<code>` (plan invite short link, resolves client-side to the plan; it carries no secret, and the code itself admits new members while the plan is taking answers — [ADR 0022](decisions/0022-a-plan-link-admits-new-members-while-the-plan-is-asking.md)), `/p/<code>` (plan page, same code and same rule), `/a#<token>` (re-entry from email, single-use), `/e#<token>` (email preferences), `/v#<token>` (email verification). Every token is in the fragment, which no server receives, and the client takes it out of the address bar before the router loads ([ADR 0023](decisions/0023-emailed-tokens-travel-in-the-fragment.md)).
- Universal links / App Links: `apple-app-site-association` and `assetlinks.json` served from the domain so that once the app is installed, chat links open in-app with the same identity (guest → app flow).
- Email: a separate sending subdomain (`mail.<domain>`) authenticated with SPF, DKIM and DMARC (`p=quarantine` after warm-up). Transactional only.

### 5.3 Secrets and configuration

- Client bundle contains only the Supabase URL, anon key, Turnstile site key and the app origin. Everything else lives in Edge Function secrets (`supabase secrets set`): Resend API key, Resend webhook secret, Apple/Google OAuth secrets, Turnstile secret, service-role key (never in the client, never in the repository).
- `app.config.ts` reads `EXPO_PUBLIC_*` variables per environment; EAS Build profiles (`development`, `preview`, `production`) map to them.
- `supabase/config.toml` is committed; project refs per environment are set through CI variables.

### 5.4 Naming independence

The code uses `circles` as a package scope and bundle identifier prefix (`app.circles.*`) but display strings, the sending domain, the deep-link host, store metadata and the wordmark are all read from one `packages/config/brand.ts`. Renaming later is a config change plus store submissions, not a refactor.

### 5.5 Cost during validation

Supabase Free (US$0) → Pro (US$25); EAS Starter (US$19); Resend Free (US$0); Apple Developer Program (US$99/year, Slice 3); Google Play (US$25 once, Slice 3); domain (~US$20/year). Expected run-rate: US$19–44/month before native, plus store accounts at Slice 3.

## 6. Domain model (domain-driven design)

### 6.1 Ubiquitous language

The words below are the only words used in code, schema, copy keys and conversation. Screen copy may say "catch-up" or "quiet ask"; the code says `Plan` and `QuietAsk`.

| Term | Meaning |
|---|---|
| **Circle** | A persistent private group of people who already know each other. The unit of retention and of every authorisation check. |
| **Member** | An identity's membership of a circle. Has a display name snapshot and a role (`owner`, `member`). Anonymous or permanent. |
| **Identity** | A Supabase auth user: anonymous, or permanent (email / Apple / Google). A person may hold one identity; reattachment moves a membership between identities. |
| **Invite** | A rotatable capability link that admits people into a circle. Stored as a hash. |
| **Plan** | One attempt by a circle to meet. Has a `mode` (`named` or `quiet`), a `window`, a `duration`, a `quorum`, `requiredMembers`, a `deadline`, and a `revision`. |
| **QuietAsk** | A plan in `quiet` mode while it is `seeking_interest`. Has an initiator (protected), a threshold, an expiry. |
| **Interest** | A member's private answer to a quiet ask: `keen` or `not_this_time`. |
| **Organiser** | The member who may confirm, edit, reschedule or cancel a plan. A quiet plan has no organiser until someone accepts the role. |
| **Response** | A member's answer to a plan revision: `windows`, `flexible`, `none_work`, `more_notice`, `not_this_time`. |
| **WillingWindow** | A half-hour-aligned interval a member would actually be up for. The only availability data that leaves a device. |
| **Candidate** | A start/end of the plan's duration with the set of members available, ranked by the engine. At most three per candidate set. |
| **Confirmation** | The organiser's chosen candidate frozen with place and note. One active per revision. |
| **Attendance** | A member's status against a confirmation: `going`, `cant`, `unknown`, later `was_there`. |
| **Outcome** | The organiser's report on a confirmation: `happened`, `cancelled`, `moved_outside`, `not_sure`. `happened` sets the circle's `lastMetAt`. |
| **Cadence** | The circle's loose meeting rhythm and who gets nudged next (`last_organiser`, `take_turns`, `owner`). |
| **Contact** | A verified email address attached to a membership for plan updates. Private schema. |
| **Nudge** | A conversion prompt (save your place / get the app) with its moment and cap state. |

### 6.2 Bounded contexts

Seven contexts. Each owns its tables, its domain module, its Edge Functions and its screens. Contexts talk through domain events (in-process on the server, persisted in an outbox) and through explicit read models, never by reaching into each other's tables.

| Context | Owns | Core aggregates | Key rules |
|---|---|---|---|
| **Identity & Access** | Auth users, profiles, sessions, reattachment, SSO linking | `Profile` | A permanent identity may absorb an anonymous one; reattachment is only within a circle the anonymous member already belongs to; organiser roles require a permanent identity |
| **Circles** | Circles, members, invites, cadence settings | `Circle` (root) with `Member`, `Invite` | Owner is a member; invite secrets stored hashed; removal revokes access immediately; member cap 20 ([ADR 0012](decisions/0012-circle-member-cap-of-twenty.md)), floor 3 for quorum defaults |
| **Planning** | Plans, revisions, quiet asks, interest, organiser role | `Plan` (root) with `Revision`, `Interest` | State machine (§8.3); quiet initiator never exposed; threshold transition is atomic and once; a quiet plan has no organiser until accepted; deadline never after last possible start |
| **Availability** | Responses, willing windows, calendar boundary | `Response` (root per member × revision) with `WillingWindow` | Windows are 30-minute aligned, non-overlapping, inside the plan window; `flexible` is explicit; raw calendar data never enters |
| **Scheduling** | The candidate engine and its results | `CandidateSet` (root) with `Candidate` | Pure, deterministic, versioned; eligibility = required members ∧ quorum ∧ inside window; ranking = attendance → earlier date → earlier start; date diversity; non-responders unavailable; flexible-only sets rank below explicit ones |
| **Confirmation & Outcomes** | Confirmations, attendance, outcome reports, `lastMetAt` | `Confirmation` (root) with `Attendance`, `Outcome` | One active confirmation per revision; frozen on confirm; reschedule supersedes, never mutates; `happened` is the only outcome that moves `lastMetAt` |
| **Communication** | Notification jobs, push devices, email contacts, subscriptions, action tokens, delivery events, templates | `NotificationJob`, `Contact` | Idempotency key per (recipient, plan, revision, kind, occurrence); quiet hours; one deadline reminder per member per plan; suppression on bounce/complaint; scope `plan_updates` only in MVP |
| **Growth** (supporting) | Nudge state, conversion analytics, OG previews | `NudgeState` | Never before an answer; once per moment per plan; 30-day back-off after two dismissals; installed identities never see app nudges |

`Analytics` is a generic subdomain: an insert-only event log with a typed catalogue, no behaviour.

Context map: **Circles** is upstream of everything (membership is the authorisation root). **Planning** is upstream of **Availability** and **Scheduling**; **Scheduling** is a pure downstream service with no persistence of its own beyond results. **Confirmation** consumes Scheduling results and Planning state. **Communication** is a downstream consumer of domain events from all contexts and never called synchronously by them. **Identity** is a shared kernel used by Circles (membership) and Communication (contacts).

### 6.3 Domain events

Emitted by aggregates, persisted in `jobs.outbox` (ADR 0003) by the same transaction that changes state — through `jobs.emit()`, from row triggers for facts about rows (circle created, member joined/removed, response submitted/cleared, attendance updated, nudge shown/answered) and from `planning.transition_plan()` for transitions (`planning.event_for(from_state, action)` names the event; `candidates_gone` is bookkeeping and announces nothing — `scheduling.no_eligible_candidates` is the recalculation's, from what it found) — consumed by the Communication and Analytics contexts through the scheduled dispatcher. Names are past-tense, namespaced by context.

```text
circles.circle_created          circles.member_joined         circles.member_removed
circles.invite_rotated          circles.member_reattached
planning.plan_created           planning.plan_revised         planning.plan_expired
planning.plan_cancelled         planning.quiet_ask_created    planning.interest_recorded
planning.threshold_reached      planning.organiser_accepted   planning.deadline_passed
availability.response_submitted availability.response_cleared
scheduling.candidates_generated scheduling.no_eligible_candidates
confirmation.meetup_confirmed   confirmation.meetup_rescheduled confirmation.meetup_cancelled
confirmation.attendance_updated confirmation.outcome_reported
communication.contact_verified  communication.subscription_changed communication.delivery_recorded
growth.nudge_shown              growth.nudge_answered         growth.account_claimed
```

`planning.interest_recorded` carries no member id in its payload (only the plan id); the row it relates to is protected. `planning.threshold_reached` carries the plan id and the keen count only.

### 6.4 Where each kind of rule lives

| Rule type | Lives in | Example |
|---|---|---|
| Pure calculation | `packages/domain` | Candidate ranking, quorum default, deadline defaults, nudge eligibility |
| State transition guard | `packages/domain` (pure) **and** Postgres function (authoritative) | `canTransition(plan, 'confirm', actor)`; `planning.transition_plan()` |
| A Postgres function's definition | `supabase/sql/functions/<schema>/<name>.sql`, one file each, rendered into a migration ([ADR 0015](decisions/0015-sql-functions-live-in-one-file-each.md)) | `supabase/sql/functions/planning/transition_plan.sql` |
| Invariant on data shape | Postgres constraints | One active confirmation per revision (partial unique index); windows 30-minute aligned (check); non-overlap (exclusion constraint) |
| Authorisation | RLS policies + `security definer` functions with pinned `search_path` | A member selects only circles they belong to |
| Orchestration | Edge Functions (application layer) | `confirm-meetup` validates, calls the transition function, writes the outbox, returns the DTO |
| Presentation | `apps/app` | Everything with a pixel |

The client imports the same `packages/domain` the server uses, so the app can show "this candidate is eligible" or "you can't confirm yet" without a round trip, and the server remains the only authority.

## 7. Code organisation

### 7.1 Repository layout

```text
/
├── AGENTS.md                       # rules, commands, boundaries, definition of done (authoritative)
├── README.md
├── package.json                    # pnpm workspace root; `pnpm check` runs everything
├── pnpm-workspace.yaml
├── apps/
│   └── app/                        # the Expo universal app
│       ├── app.config.ts
│       ├── eas.json
│       ├── app/                    # Expo Router routes ONLY — thin composition, no logic
│       │   ├── _layout.tsx
│       │   ├── index.tsx           # Welcome (SSO / email)
│       │   ├── (auth)/             # email, code, name
│       │   ├── join.tsx            # /join#secret → redeem
│       │   ├── j/[code].tsx        # plan short link → respond
│       │   ├── p/[code].tsx        # plan page (candidates / confirmed / cancelled …)
│       │   ├── a/[token].tsx       # email re-entry
│       │   ├── e/[token].tsx       # email preferences (no sign-in)
│       │   ├── v/[token].tsx       # email verification landing
│       │   ├── circles/            # list, [id], [id]/settings, [id]/plan/new, …
│       │   ├── og/[kind]+api.ts    # server route: OG tags for link previews (web only)
│       │   └── +not-found.tsx
│       └── src/
│           ├── features/           # one folder per bounded context, screen-level composition
│           │   ├── identity/       # welcome, sso, code, name, reattach, save-access
│           │   ├── circles/        # create, home (3 states), settings, invite
│           │   ├── planning/       # choose-mode, plan-setup, custom-window, quiet-ask, edit, cancel
│           │   ├── availability/   # painter, shortcuts, none-work, calendar overlay (native)
│           │   ├── scheduling/     # candidates (organiser / member), no-quorum, deadline-passed
│           │   ├── confirmation/   # review, confirmed (organiser / guest), change-time, outcome, attendance
│           │   ├── communication/  # email offer, check-email, verified, preferences, push-ask
│           │   └── growth/         # nudge cards and sheet, app landing
│           ├── components/         # design-system components (Button, Card, Chip, Marks, Notice, Track…)
│           ├── platform/           # adapters: calendar, push, share, storage, links, turnstile
│           ├── data/               # supabase client, query keys, repositories (typed reads), function callers
│           ├── copy/               # all user-facing strings, keyed; no strings in components
│           └── analytics/          # track() with the typed catalogue from packages/contracts
├── packages/
│   ├── domain/                     # PURE TypeScript: entities, value objects, rules, state machines, engine
│   │   └── src/{circles,planning,availability,scheduling,confirmation,communication,growth,shared}/
│   ├── contracts/                  # Zod schemas for function I/O, DTOs, deep links, analytics events;
│   │                               # generated Supabase types (committed); event catalogue
│   ├── tokens/                     # design tokens generated from docs/design/gen.py values; fonts
│   └── config/                     # brand.ts (name, domain, sender), feature flags, environment schema
├── supabase/
│   ├── config.toml
│   ├── migrations/                 # versioned SQL; the only way schema changes. Function
│   │                               # definitions here are generated — see sql/functions
│   ├── sql/functions/<schema>/     # one file per database function: body, comment and grants.
│   │                               # The source of truth (ADR 0015); `pnpm gen:functions`
│   │                               # renders them into a migration, `pnpm check` gates drift
│   ├── seed.sql                    # three circles incl. incomplete responses and a quiet ask
│   ├── functions/
│   │   ├── _shared/                # auth, zod, outbox, resend, push, logging, errors
│   │   ├── redeem-invite/
│   │   ├── join-plan/              # ADR 0022 (S1-24c)
│   │   ├── reattach-member/
│   │   ├── claim-identity/
│   │   ├── create-plan/
│   │   ├── answer-interest/
│   │   ├── accept-organiser/
│   │   ├── submit-availability/
│   │   ├── recalculate-candidates/
│   │   ├── confirm-meetup/
│   │   ├── revise-plan/
│   │   ├── cancel-plan/
│   │   ├── hand-off-organiser/
│   │   ├── extend-deadline/
│   │   ├── report-outcome/
│   │   ├── request-email-updates/
│   │   ├── verify-email-contact/
│   │   ├── manage-email-preferences/
│   │   ├── email-provider-webhook/
│   │   ├── register-push-device/
│   │   ├── generate-ics/
│   │   ├── record-nudge/
│   │   ├── track-events/
│   │   ├── process-scheduled-jobs/
│   │   └── delete-account/
│   └── tests/database/             # pgTAP: constraints, RLS, transitions, retention
├── tests/
│   ├── e2e-web/                    # Playwright, incl. WhatsApp/Messenger in-app-browser user agents
│   ├── e2e-native/                 # Maestro flows
│   └── fixtures/                   # builders (circle(), plan(), response()) — no copied JSON
├── docs/
│   ├── decisions/                  # ADRs
│   ├── design/                     # canvas source (already present)
│   └── …
├── scripts/                        # gen-tokens, gen-types, seed, dev-links
└── .github/workflows/
```

### 7.2 Dependency rule

```text
apps/app ──▶ packages/contracts ──▶ packages/domain
   │                 ▲                    ▲
   └──▶ tokens       │                    │
supabase/functions ──┘────────────────────┘
```

- `packages/domain` imports nothing but the standard library and `date-fns-tz` (via a thin `Clock`/`Zone` port). No Supabase, no React, no I/O.
- `packages/contracts` imports `domain` for shared types and adds Zod schemas and generated DB types.
- `apps/app` and `supabase/functions` import both; they never import each other.
- Inside `apps/app`, `app/` routes import from `src/features`; `src/features` import `components`, `data`, `platform`, `copy`, `analytics`; `data` and `platform` never import `features`. Enforced with `eslint-plugin-boundaries`.

### 7.3 The domain package, by context

```text
packages/domain/src/
├── shared/         Instant, LocalDate, Zone, Interval (30-min aligned), Result<E,T>, DomainEvent
├── circles/        Circle, Member, Invite, cadence rules (nextDueAt, nudgeRecipient), quorumDefault
├── planning/       Plan, Revision, PlanState machine, deadlineDefaults, windowPresets, QuietAsk rules
├── availability/   Response, WillingWindow, normalise/merge windows, shortcuts → windows
├── scheduling/     generateCandidates(inputs): CandidateSet  (the engine, §12)
├── confirmation/   Confirmation, Attendance, Outcome, lastMetAt rule
├── communication/  notificationKinds, eligibility(recipient, kind, state), idempotencyKey, quietHours
└── growth/         nudgeEligibility(moment, history)
```

Every module exports plain functions over plain data (`readonly` types), plus the Zod-free domain types that `contracts` wraps. Functions return `Result` rather than throwing for expected failures.

### 7.4 Application layer (Edge Functions)

Each function is one use case with the same skeleton:

1. Parse the request with its Zod schema from `contracts`.
2. Authenticate (`Authorization: Bearer <JWT>`), load the actor's membership.
3. Load the aggregate via a repository (`_shared/repos`), call the domain function, get a `Result`.
4. Persist inside one transaction through a Postgres function (`select planning.transition_plan(...)`) that re-checks the guard with row locks and appends outbox events.
5. Return a DTO; never the raw row.

Functions are thin; if a function grows a second responsibility it becomes two functions.

Steps 1, 2 and 5 are `supabase/functions/_shared/` (S1-13) rather than written out each time: `http.ts` wraps a handler with parsing, authentication, the idempotency record and the `Problem` mapping; `db.ts` offers the two clients; `idempotency.ts`, `rate.ts` and `turnstile.ts` are the rest of the kit. Two rules govern what may live there and what may not:

- **Authorisation is in the database, never in the kit.** A definer function decides who may do a thing, and the Edge Function calls it with the *caller's* JWT so `auth.uid()` is the person who asked. A guard written in a function is a guard the next function has to remember; a guard in SQL holds even for a client that calls the RPC directly. The service-role client exists for the kit's own bookkeeping and for `claim-identity`, whose authorisation is a second token the database cannot see.
- **What the kit adds is volume control, not permission.** Turnstile and the rate counters make abuse expensive; skipping them lets somebody make more requests, never a request the database would have refused.

Errors carry two levels: `Problem.error` is the coarse category that picks the status code, and `Problem.reason` is the precise cause a *screen* turns on (`invite_inactive`, `duplicate_name`). Clients branch on the reason and never on the message, which is copy.

### 7.5 Screens ↔ routes ↔ canvas

Every artboard in `docs/design/` maps to one route + one feature component; the mapping lives in `apps/app/src/features/README.md` and is kept current in PRs. The route file renders exactly one feature screen and passes params; states (empty, partial, loading, error, offline, denied, expired) are props of the feature screen, not separate routes.

### 7.6 Rules for coding agents (goes into `AGENTS.md`)

- Product rules live in the spec; architecture rules live here; both change only through an ADR.
- Never put a decision in a screen. If a screen needs to know whether something is allowed, the answer comes from `packages/domain`.
- Never write a table type by hand; run `pnpm gen:types`.
- Never change schema in the dashboard; write a migration and a pgTAP test in the same PR.
- Every RLS policy ships with a test that proves both the allow and the deny.
- Every user-facing string is a key in `src/copy`; no literals in components.
- Every analytics event is declared in the catalogue first.
- No sensitive data (names, emails, tokens, event titles, notes) in logs or analytics payloads. A plan's short code is not a token for this rule: it is in every link the product shares, by design, and what it admits to is bounded and visible ([ADR 0022](decisions/0022-a-plan-link-admits-new-members-while-the-plan-is-asking.md)). It still stays out of analytics payloads and our own function logs.
- `pnpm check` (format, lint, typecheck, unit, database tests, web e2e smoke) must pass; CI runs the same command.
- Keep files under ~300 lines; split by responsibility.
- Prefer a small pure function to a dependency.

## 8. Data model

### 8.1 Schemas

- `public` — everything a client may read through RLS. Exposed via the Data API.
- `private` — email contacts, subscriptions, action tokens, delivery events, quiet-ask initiator, interest rows, push tokens. **Not exposed** through the Data API (`pgrst` config excludes it); reachable only by `security definer` functions and Edge Functions using the service role.
- `analytics` — insert-only events and the views the founder dashboard reads. Not exposed.
- `jobs` — outbox, notification jobs, cron bookkeeping. Not exposed.

### 8.2 Tables

All ids are `uuid` (v7 where ordering helps). All tables have `created_at`, `updated_at`; soft-delete columns only where the spec's retention needs them. Times are `timestamptz`; wall-clock context carries an IANA `time_zone` column.

**Identity & Access (`public`)**

| Table | Columns of note | Constraints |
|---|---|---|
| `profiles` | `user_id` (pk → auth.users), `display_name`, `time_zone`, `is_permanent`, `app_installed_at` | `display_name` 1–40 chars |

**Circles (`public`)**

| Table | Columns of note | Constraints |
|---|---|---|
| `circles` | `id`, `owner_user_id`, `name`, `color`, `time_zone`, `cadence` (`weekly|fortnightly|monthly|two_monthly|none`), `nudge_policy` (`last_organiser|take_turns|owner`), `default_duration_minutes`, `default_quorum`, `default_area`, `status` (`active|archived`), `last_met_at`, `cadence_snoozed_until` | owner must be a member (trigger) |
| `circle_members` | `circle_id`, `user_id`, `display_name_snapshot`, `role` (`owner|member`), `status` (`active|removed`), `joined_at`, `muted_quiet_asks`, `muted_all` | unique `(circle_id, user_id)`; active members ≤ 20 (trigger); one active display name per circle (partial unique index) |
| `circle_invites` | `circle_id`, `secret_hash`, `created_by`, `revoked_at`, `use_count` | one non-revoked invite per circle (partial unique) |

**Planning (`public` + `private`)**

| Table | Columns of note | Constraints |
|---|---|---|
| `plans` | `id`, `circle_id`, `mode` (`named|quiet`), `state`, `organiser_user_id` (nullable), `title`, `category`, `time_zone`, `window_start`, `window_end`, `daily_start_local`, `daily_end_local`, `duration_minutes`, `quorum`, `response_deadline`, `quiet_threshold`, `quiet_expires_at`, `quiet_preset`, `revision`, `scoring_version`, `short_code` | `window_end - window_start ≤ 30 days`; deadline ≤ last possible start; a seeking quiet ask's stop time set and strictly before the last possible start; no organiser on a quiet plan until it has opened; `short_code` unique |
| `plan_required_members` | `plan_id`, `revision`, `user_id` | |
| `private.plan_initiators` | `plan_id`, `initiator_user_id` | never selectable by clients |
| `private.plan_interest` | `plan_id`, `user_id`, `response` (`keen|not_this_time`), `responded_at` | unique `(plan_id, user_id)`; exposed to clients only as a count after threshold |

**Availability (`public`)**

| Table | Columns of note | Constraints |
|---|---|---|
| `plan_responses` | `plan_id`, `revision`, `user_id`, `status` (`windows|flexible|none_work|more_notice|not_this_time`), `used_calendar_overlay`, `submitted_at` | unique `(plan_id, revision, user_id)` |
| `willing_windows` | `response_id`, `starts_at`, `ends_at` | 30-min aligned (check on `extract(minute) in (0,30)`); no overlap per response (`exclude using gist`); inside plan window (trigger) |

**Scheduling (`public`)**

| Table | Columns of note | Constraints |
|---|---|---|
| `candidate_sets` | `plan_id`, `revision`, `input_version`, `scoring_version`, `generated_at`, `eligible_count`, `near_miss_reason` | unique `(plan_id, revision, input_version)` |
| `candidates` | `candidate_set_id`, `rank`, `starts_at`, `ends_at`, `available_user_ids uuid[]`, `explanation_code` | rank 1–3 |

**Confirmation & Outcomes (`public`)**

| Table | Columns of note | Constraints |
|---|---|---|
| `meetup_confirmations` | `plan_id`, `revision`, `candidate_id`, `starts_at`, `ends_at`, `available_user_ids uuid[]` (frozen at confirm), `place_name`, `place_url`, `note`, `chased_answer` (`none|one|more`, asked on the confirmation review), `confirmed_by`, `confirmed_at`, `status` (`active|superseded|cancelled|completed`), `superseded_at`, `superseded_reason` (`reopen|cancel|outcome`) | one `active` per `(plan_id, revision)` (partial unique); **written by `transition_plan(…, 'confirm', …)`** in the same transaction as the state change, the derived attendance rows and the `meetup_confirmed` event (payload keys `candidate_id, place_name, place_url, note, chased_answer`; refused as `candidate_has_passed` once the candidate's start is behind `now()`, as `confirm()` has it); a deferred constraint trigger refuses a commit with a `confirmed` plan lacking an active confirmation; `place_url` http(s); `note` ≤ 280; status leaves `active` only through the triggers on `plans` (reopen/cancel) and `outcome_reports` — not even `service_role` may update it |
| `attendance` | `confirmation_id`, `user_id`, `status` (`going|cant|unknown|was_there|missed`), `updated_at` | unique `(confirmation_id, user_id)`; participant of the confirmation's revision; transitions per `updateAttendance` enforced by trigger (no retrospective status before `ends_at`; a repeat is a no-op); members insert and update only their own row, only `status`, and **only while an active member of the circle** — the policy says so rather than relying on a trigger's privileges ([SUS-75](https://linear.app/sushen-project/issue/SUS-75)); `was_there`/`missed` rows are readable by their subject alone ("nobody is told who came") — corroboration is computed, never shown as names |
| `outcome_reports` | `confirmation_id`, `reported_by`, `outcome` (`happened|cancelled|moved_outside|not_sure`), `note`, `moved_outside`, `reported_at` | one per confirmation per reporter; written only through `report_outcome(confirmation_id, outcome, note, moved_outside)` (actor = `auth.uid()`), only after `ends_at`, by the organiser; the insert trigger runs `report_outcome` through `transition_plan`, closes the confirmation (`cancelled` for a `cancelled` outcome, else `completed`) and moves `circles.last_met_at` to `starts_at` for `happened` only, never backwards |

**Communication (`private` + `jobs`)**

| Table | Columns of note | Constraints |
|---|---|---|
| `private.push_devices` | `user_id`, `expo_push_token`, `platform`, `enabled`, `last_error_at` | token unique |
| `private.email_contacts` | `user_id`, `email_normalized`, `email_hash` (generated: SHA-256 of `email_normalized`), `verified_at`, `status`, `suppressed_at`, `suppression_reason` | unique per `(email_hash, user_id)` — two guest memberships may each be reachable at one address (spec §9), while suppression stays global by hash in `email_suppressions`; status shape (`verified` ⇒ `verified_at`; `suppressed` ⇒ time and reason) |
| `private.email_subscriptions` | `contact_id`, `user_id`, `scope` (`plan_updates`), `plan_id`, `status`, `consented_at`, `withdrawn_at`, `consent_text_version` | `plan_id` required for `plan_updates`; `(contact_id, user_id)` references the contact and its owner together — consent is the owner's |
| `private.email_action_tokens` | `contact_id`, `purpose` (`verify|prefs|reentry`), `token_hash`, `expires_at`, `used_at`, `membership_circle_id` + `membership_user_id` (required for `reentry`, forbidden otherwise) | hash unique; single use by `used_at` in the consuming statement; `(contact_id, membership_user_id)` references the contact and its owner, and a `reentry` token is refused at issue for a permanent identity; both references `on update cascade`, deferred, so `reattach-member` can move the membership to the returning guest's new identity. It must **merge** rather than move the *contact*: since uniqueness became `(email_hash, user_id)` the new identity may already hold that address, and moving would collide ([SUS-75](https://linear.app/sushen-project/issue/SUS-75)) |
| `private.email_delivery_events` | `job_id`, `provider_message_id`, `event_type`, `provider_occurred_at`, `recorded_at` | unique `(provider_message_id, event_type)` |
| `private.email_suppressions` | `email_hash`, `reason`, `suppressed_at` | written by trigger when a contact is suppressed; never deleted; a new contact for a suppressed hash is created suppressed (spec §9) |
| `jobs.notification_jobs` | `channel` (`push|email`), `kind` (a `NotificationKind`), `user_id`, `contact_id` (→ `email_contacts`), `plan_id`, `plan_revision`, `scheduled_for`, `idempotency_key`, `status` (`scheduled|sent|failed|skipped`), `attempt_count`, `last_error`, `sent_at`, `provider_message_id` | `idempotency_key` unique, 64 hex (the domain's SHA-256); push needs `user_id` and no `contact_id`, email the reverse |
| `jobs.outbox` | `seq` (drain order), `event_name`, `aggregate_type`, `aggregate_id`, `payload`, `occurred_at`, `processed_at`, `attempts`, `last_error` | `event_name` in `DOMAIN_EVENT_NAMES`, `last_error` a code (`^[A-Za-z0-9_.:/-]{1,120}$`, never a message) and payload keys at any depth free of the `FORBIDDEN_PAYLOAD_KEYS` fragments — both rendered into the migration by `scripts/gen-events.mjs`, checked by `pnpm check:events` (`jobs.carries_content()`, also on `audit_log.metadata` and `analytics.events.properties`); written only through `jobs.emit()` — the service role holds no insert; every string value at any depth is at most 40 characters of `[A-Za-z0-9_./:+-]` (an id, an instant, an enum, a zone — never an address, a sentence or a token) |
| `jobs.cron_leases` | `name`, `leased_until`, `holder`, `last_started_at`, `last_finished_at` | one row per cron job; taken with `jobs.acquire_lease(name, ttl, holder)` (one statement, one winner) and released with `jobs.release_lease(name, holder)` |

**Availability memory (`public`)**

| Table | Columns of note | Constraints |
|---|---|---|
| `member_dayparts` | `circle_id`, `user_id`, `summary` (`{parts, counts}` — `DayPartSummary` without `userId`), `computed_at` | a running total: each retention run adds the counts of the windows it is about to delete to what is stored, then re-derives `parts` (ADR 0005); readable by that member only, and only while a member; deleted 30 days after removal or archiving; no client writes. The pre-fill adds it to the member's own retained answers when it is read (`usualDayparts`, ADR 0037): the table holds what has been deleted, the answers hold the rest, and nothing writes it when somebody answers |

**Growth (`public`)**

| Table | Columns of note | Constraints |
|---|---|---|
| `nudge_states` | `user_id`, `moment` (the catalogue's two `moment` enums), `plan_id` (required for a plan-bound moment, forbidden for `reattached`/`settings` — a `case` constraint), `shown_at`, `answer` (`dismissed|tapped`), `snoozed_until` | unique `(user_id, moment, plan_id)` with nulls not distinct; own rows only; a plan-bound row only for a plan in one's circles |

**Analytics & audit**

| Table | Columns of note |
|---|---|
| `analytics.events` | `event_name`, `schema_version`, `user_id`, `anonymous_id`, `circle_id`, `plan_id`, `properties jsonb`, `occurred_at`, `received_at` — validated against the catalogue in the ingest function; no foreign keys (events outlive rows; deletion nulls identifiers); the table refuses a content key in `properties` |
| `private.audit_log` | `actor_user_id`, `action` (a dotted verb, `^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$`, ≤60), `resource_type` (an aggregate name), `resource_id`, `metadata` (same no-content rule as the outbox), `occurred_at` |

### 8.3 Plan state machine, enforced in one place

```text
draft ─named──▶ collecting ─(eligible)──▶ ready ─confirm──▶ confirmed ─outcome──▶ completed
  └─quiet──▶ seeking ─threshold──▶ collecting          │            ├─reopen──▶ collecting (rev+1)
                └─expiry──▶ expired                    ├─cancel──▶ cancelled
collecting ─(edit)──▶ collecting (rev+1)               │
collecting ─(last start passed)──▶ expired             │
ready ─(response change)──▶ collecting ─ recalculate ──┘
```

`planning.transition_plan(plan_id, action, actor, payload)` is a `security definer` Postgres function that takes `select … for update` on the plan row, validates the transition table (mirrored from `packages/domain/planning`), applies the change, writes the outbox event, and returns the new state. Edge Functions call it; nothing else writes `plans.state`. A `check` constraint enumerates valid states; a trigger rejects direct updates to `state` from non-definer contexts.

### 8.4 Row-level security strategy

- `public` tables: RLS on; default deny; one policy per operation; `select` policies use `exists (select 1 from circle_members m where m.circle_id = … and m.user_id = auth.uid() and m.status = 'active')`, wrapped in a stable helper `auth_is_member(circle_id)` for performance.
- Writes: members write their own `plan_responses` and `willing_windows` only through `replace_response`, which replaces an answer and its windows in one transaction ([ADR 0013](decisions/0013-availability-written-only-through-replace-response.md)); they may `insert/update` only their own `attendance`, `nudge_states` and permitted `profiles` columns directly. All other writes go through functions.
- Anonymous identities (`auth.jwt() ->> 'is_anonymous' = 'true'`) are restricted with **restrictive** policies from creating plans or circles (the organiser gate).
- `private`, `jobs`, `analytics`: no grants to `anon`/`authenticated`; reachable only through definer functions with `set search_path = ''` and the service role in Edge Functions.
- Quiet interest before threshold is never joined into any public view; after threshold, a view `plan_interest_counts` exposes counts only.

### 8.5 Retention jobs (pg_cron, daily, in the database — ADR 0014)

| Data | Rule |
|---|---|
| Willing windows | Keep 12 months for members of active circles (review 6.9); derived day-part summary written to `member_dayparts` per member × circle first; 30 days after the member is removed or the circle archived |
| Revoked invite hashes | 30 days |
| Outbox (processed rows only), notification jobs and delivery events | 30 days |
| Unverified contacts and expired tokens | 7 days |
| Verified plan-only contacts | 30 days after every plan they are subscribed to has completed, expired or been cancelled; suppressed contacts and `email_suppressions` are never deleted |
| Abandoned anonymous identities (no membership, > 30 days) | delete |
| Audit log | 12 months |
| Deleted accounts | revoke immediately; purge identifiers within 30 days |

## 9. Backend surface

### 9.1 Edge Functions (task endpoints)

| Function | Auth | Does |
|---|---|---|
| `redeem-invite` | anonymous or permanent | Verify Turnstile (web), hash the fragment secret, check not revoked, create membership, return circle DTO |
| `join-plan` | anonymous or permanent | Verify Turnstile (web); takes a plan short code. **The plan admits** only while it is taking answers (`collecting` or `ready`, deadline ahead) in an active circle; an unknown code and a plan that is not admitting both get the one `invite_inactive`, so a refusal does not distinguish them. (A join that succeeds does say the plan is taking answers; that is not hidden.) **A caller who is already an active member** sends no name and only gains the participant row for the current revision, if missing. **A caller who is not** becomes a member under the same cap, name and rejoin rules as `redeem-invite`, with their own reasons (`circle_full`, `duplicate_name`, `display_name_unusable`), and a participant, in one transaction: a guest must send a display name; an account may omit it and joins under its profile name, and sends one after a `duplicate_name`. Moves the plan's quorum only when nobody chose it (`quorum_source = 'defaulted'`), through `quorum_follows` — the audience's own rule, never downward, no new revision and no event (ADR 0026); a chosen quorum is untouched. Adding somebody to the plan bumps its `input_version` and recalculates in the same request, as an answer does (ADR 0018), and a call that adds nobody changes neither. Rate-limited per code and per address ([ADR 0022](decisions/0022-a-plan-link-admits-new-members-while-the-plan-is-asking.md)) |
| `reattach-member` | anonymous | Given circle + target anonymous membership without a permanent identity (chosen from the Continue-as list, or authorised by an emailed re-entry token), move the membership to the caller's new anonymous identity; write `member_reattached`; rate-limited per circle |
| `claim-identity` | permanent (just linked) | Link an anonymous identity's memberships to the permanent one after `linkIdentity`/`signInWithIdToken`; merges profiles; idempotent |
| `get-invite-link` | owner | The live invite's secret, re-derived and checked against the stored digest, or `null` when it cannot be shown ([ADR 0028](decisions/0028-an-invite-secret-is-derived-so-its-owner-can-see-it-again.md)); a read, no idempotency record |
| `rotate-invite` | owner | New derived secret through `issue_invite`: the old link is revoked in the same statement, members are untouched, `circles.invite_rotated` |
| `remove-member` | owner | `remove_member` (never the owner; only someone active), whose trigger deletes their answers to plans still asking and leaves those rosters; recalculates each such plan in the same request |
| `create-plan` | permanent member | Named or quiet; applies defaults from the circle; validates window/deadline; enqueues notifications |
| `answer-interest` | member | Records interest in `private`; atomically evaluates threshold under a plan row lock; transitions once. An ask held at its threshold beside an open plan is tried again on every answer and on every dispatcher sweep ([ADR 0035](decisions/0035-the-quiet-ask-at-twenty-members.md)). Answers `{ recorded: true }` — never a count, nor whether this answer opened it; what the ask looks like now is `quiet-view`'s |
| `accept-organiser` | keen member (quiet) or initiator; the owner once replies close | Sets `organiser_user_id` on an opened quiet plan with none; first writer wins. How the caller came to it (initiator, volunteer, owner's fallback) is worked out server-side and never stored, returned, logged or put in an event |
| `quiet-view` | member | What the caller may see of a quiet plan: `quietView` from `packages/domain`, built on the server from the caller's own private facts (initiator or not, their answer, whether an expired ask had opened) and returned as capabilities only — never the facts. A read |
| `submit-availability` | member | Validates and normalises windows, replaces the member's response for the current revision (bumping `input_version`), then **runs the recalculation inline, in the same request** ([ADR 0018](decisions/0018-the-recalculation-runs-in-the-request-that-caused-it.md)) — the compare-and-set in `store_candidate_set` is what makes that safe, and a recalculation that fails does not fail the answer |
| `recalculate-candidates` | internal (`CRON_SECRET`) | The same work for a plan with no request of its own to run in — a removal, a deadline, a recalculation that lost its compare-and-set. Loads inputs, runs `generateCandidates`, persists if `input_version` and `revision` are still current, transitions `collecting ↔ ready` |
| `confirm-meetup` | organiser | Candidate freshness check, one active confirmation, freezes times, enqueues confirmations and reminders |
| `revise-plan` | organiser | Edits window/duration/band → new revision, invalidating responses and enqueuing a re-ask; **adjusts** quorum, deadline or required members without one ([ADR 0017](decisions/0017-quorum-and-deadline-adjust-a-plan-without-a-revision.md)); `preview` answers what an edit would cost without making it (spec §5.3); reopens a confirmed plan |
| `cancel-plan` | organiser or owner; a seeking quiet ask's initiator | Final state with optional note; enqueues cancellation notices. Withdrawing a quiet ask before threshold is this endpoint too: no note, no event, nobody told (spec §9) |
| `hand-off-organiser` | organiser | `hand_off_organiser`: the `hand_off` transition to an active member the plan is asking, with a saved place (`not_a_participant`, `requires_saved_place` otherwise), `planning.organiser_changed`, and the old organiser's queued organiser letters skipped in the same transaction (S2-05) |
| `extend-deadline` | organiser | `extend_deadline`: an `adjust` to a day from the later of now and the deadline, never past the last possible start less thirty minutes, once per revision (`already_extended`, `no_time_to_extend`) (S2-05) |
| `report-outcome` | organiser (or member for attendance) | Records outcome/attendance; sets `last_met_at` on `happened` |
| `request-email-updates` | member | Normalise, dedupe per identity, create the contact and record the consent as given ([ADR 0019](decisions/0019-consent-is-recorded-when-it-is-given.md)), enqueue the verification email — whose token is minted by the sender ([ADR 0020](decisions/0020-the-verification-token-is-minted-by-the-sender.md)). Answers identically for a new, verified, shared or suppressed address |
| `verify-email-contact` | token | Consume the single-use token, verify **every contact holding that address**, drop subscriptions to finished plans and to circles the person has left, send the current state once if a meetup is already locked in |
| `manage-email-preferences` | token | Show/disable subscriptions without sign-in |
| `email-provider-webhook` | Resend signature | Dedupe by provider message id, record delivery, suppress on hard bounce/complaint |
| `register-push-device` | permanent | Upsert Expo push token |
| `generate-ics` | member | Standards-compliant `.ics` for a confirmation; no tokens in the file |
| `record-nudge` | member | Apply nudge caps, record shown/answered |
| `track-events` | any | Validate against the catalogue, strip anything not in the schema, insert |
| `process-scheduled-jobs` | cron (service role) | Drain outbox → create notification jobs; send due jobs; expire quiet asks and plans; deadline reminders; cadence prompts; outcome prompts; retries with capped backoff. Not retention — that is `jobs.run_retention()` in the database ([ADR 0014](decisions/0014-retention-runs-in-the-database.md)) |
| `delete-account` | permanent | Revoke sessions, anonymise, enqueue purge |

Every function: Zod-validated input, `X-Request-Id` echoed as the user-visible reference on errors ("Ref 7F3K-2Q"), structured JSON logs without PII, idempotent on a client-supplied `idempotency_key` **in the request body** for mutations ([ADR 0016](decisions/0016-idempotency-key-travels-in-the-request-body.md)) — inside the request's own schema, so a client that omits it fails at the boundary rather than at the retry.

### 9.2 Reads

Clients read through `supabase-js` with RLS: circles I belong to, active members, plans in my circles, my response and windows, candidate sets and candidates for plans I belong to, confirmations, attendance, outcomes, nudge states. **Everything refetches on focus; nothing subscribes to Realtime.** This paragraph previously claimed Realtime on `plans` and `candidate_sets` for the organiser's candidates screen — that was written before the question in §20 was answered "refetch on focus is fine", and the spec lists Realtime subscriptions as out of scope. Adding a subscription later is an ADR, not a preference: it introduces a websocket, a free-tier quota to watch, and a second path by which the client learns a plan changed.

### 9.3 Scheduled work

`pg_cron` runs `process-scheduled-jobs` every minute via `pg_net` (`jobs.invoke_process_scheduled_jobs()`, a no-op until `circles.functions_url` and `circles.cron_secret` are set on the database — see the environments runbook) with a job lease (`jobs.acquire_lease` on `jobs.cron_leases`) so overlapping invocations are no-ops. Retention (§8.5) runs daily at 03:15 as `jobs.run_retention()`, in the database as the owner ([ADR 0014](decisions/0014-retention-runs-in-the-database.md)). Work is discovered from data (`scheduled_for <= now()`, `quiet_expires_at <= now()`, `response_deadline <= now()`, cadence due dates), never from in-memory timers.

### 9.4 The one server route in the app

`apps/app/app/+middleware.ts` (web `server` output, behind expo-router's `unstable_useServerMiddleware`) answers link-preview fetchers on `/join`, `/j/:code`, `/p/:code` — those are client pages, and a page and an API route cannot share a path, so the middleware is the only thing that sees the request first. `apps/app/app/og/[kind]+api.ts` serves the same card at an address of its own. Both are `no-store`: the card is returned at a URL people also tap, and EAS Hosting caches by URL alone ([ADR 0021](decisions/0021-the-link-preview-is-not-rate-limited.md)). Together they answer with an HTML shell carrying `og:title` (circle name only), `og:description`, `og:image` (static), and a client redirect. It reads nothing but the circle's name via a public definer function keyed by short code — not rate-limited, because a definer function called as `anon` has no caller to count and the eight-character code space is the control ([ADR 0021](decisions/0021-the-link-preview-is-not-rate-limited.md)). It never receives the invite secret (fragment) and never emits member names, dates or quiet-ask state.

## 10. Identity, sessions and continuity

- **Owner sign-in**: Sign in with Apple (`expo-apple-authentication` → `supabase.auth.signInWithIdToken`), Google (`@react-native-google-signin/google-signin` on native, Google Identity Services on web → `signInWithIdToken`), or email OTP (6-digit code). No passwords.
- **Guest**: `supabase.auth.signInAnonymously()` on first join, Turnstile-protected on web. Session persisted in `localStorage` (web) or `expo-secure-store` (native).
- **Continue as**: when a request hits a circle route with no session or a session that holds no membership, the client **signs in anonymously first**, then calls `public.guest_members_for_reattach(short_code)` — a definer function returning the circle's anonymous members (display names only, no reply state) — and offers `Continue as`. The session comes first because the function is granted to `authenticated` and not to `anon`: the client needs one to reattach in any case, so the flow loses nothing. The grant is not a volume control, though — one anonymous session can ask about any number of short codes — so the function itself counts lookups per caller (thirty an hour) through `public.take_rate_token`, which a client calling the RPC directly meets too. Selecting one calls `reattach-member`. Owners see "Priya rejoined from a new device" on circle home. Limits: 3 reattachments per membership per 7 days; a permanent member can never be reattached to.
- **Arriving on a plan link without a membership** ([ADR 0022](decisions/0022-a-plan-link-admits-new-members-while-the-plan-is-asking.md)): the guard distinguishes who is here. A **saved place** is offered one tap, "Join [circle] as [name]", which calls `join-plan`; it is never shown the list. **Anybody else** gets Continue-as with two more choices: *I'm new here* (a display name, then `join-plan`, then the plan's availability screen) and *I have an account* (sign in, then the same link again). With no guest members to list, the page goes straight to the name. When the plan is not taking answers, `join-plan` admits nobody and somebody new is pointed at the circle's invite link.
- **Save your place / organiser gate**: `linkIdentity` (email OTP) or `signInWithIdToken` (Apple/Google) on the anonymous session, then `claim-identity` to reconcile memberships if the permanent identity already existed.
- **Email re-entry**: every plan-update email deep-links to `/a#<token>` (the token in the fragment, ADR 0023); the token is single-use, 7-day, and bound to a membership. Consuming it does not mint a session (Supabase has no custom-token sign-in for anonymous users). Instead: if the browser already holds the right identity, it simply routes to the plan; if it holds no session, the client creates a fresh anonymous session and calls `reattach-member` with the token as authorisation, which moves the membership to the new identity without the "Continue as" list; if the membership belongs to a permanent identity, the page offers that identity's sign-in (Apple/Google/email code) instead. This reuses one reattachment path for both the manual and the emailed case.
- **Universal links**: once the app is installed and the person has signed in with the same identity, chat links open in-app; the web fallback is the same route.

## 11. Client architecture

- **Routing**: Expo Router groups per audience; guest routes are reachable unauthenticated and self-heal (no session → join or continue-as).
- **State**: TanStack Query for server state; feature-local `useReducer` for editors (availability painter, plan setup); no global store.
- **Availability painter**: 30-minute cells; drag paints; output is normalised windows via `domain/availability`; drafts persisted to MMKV/`localStorage` under `(plan, revision)` and resubmitted on reconnect (offline state in the manifesto).
- **Calendar boundary (native)**: `platform/calendar` exposes exactly `getBusyIntervals(range, calendarIds): Interval[]`. The `expo-calendar` event objects never leave the adapter; a unit test asserts the adapter's return type contains no title/location/attendee fields and an ESLint rule forbids importing `expo-calendar` outside `platform/calendar`.
- **Push**: registration only after the contextual ask; token sent to `register-push-device`; notification taps deep-link to the route in the payload.
- **Share**: `platform/share` wraps `Share.share` / Web Share API; message text comes from `domain/communication/shareMessages`.
- **Add to calendar**: web offers `.ics` (from `generate-ics`) and a Google Calendar template URL; native uses `expo-calendar`'s system event UI.
- **Design system**: `packages/tokens` (colour, type, spacing, radii, shadow) generated by `scripts/gen-tokens.ts` from the same values as `docs/design/gen.py`; `components/` implements Button (primary/secondary/tertiary), Card, Chip, Marks, Notice, Track, Input, Toggle, Radio, Sheet exactly as the components artboard. Icons are an inline-SVG set (`react-native-svg`).
- **Accessibility**: every control has a label; availability cells expose time ranges to screen readers; dynamic type to 200% tested in Maestro/Playwright.
- **Copy**: `src/copy/en.ts` keyed by screen; no exclamation marks lint rule for working screens (a small custom ESLint rule over copy files).

## 12. The candidate engine

`packages/domain/scheduling/generateCandidates.ts`

Inputs: plan window and daily local window, duration, circle time zone, quorum, required member ids, responses (member id → `windows | flexible | unavailable`), `now`.

1. Enumerate 30-minute start instants across the window in the circle zone, skipping starts in the past and starts whose end exceeds the daily window (DST handled by converting local wall-clock to instants per day).
2. For each start: available set = members whose windows fully contain `[start, start+duration)` ∪ flexible members. Non-responders, `none_work`, `more_notice`, `not_this_time` are unavailable.
3. Eligible iff all required members available ∧ `|available| ≥ quorum`.
4. Rank: `|available|` desc → sets with at least one explicit-window member before flexible-only sets → earlier local date → earlier local start.
5. Select up to three with date diversity: take the top; then prefer the best candidate on a different date when its attendance equals the next best's; never pick two starts on the same date within `duration` of each other.
6. Emit `explanation_code` per candidate (`best_attendance`, `same_attendance_weekend`, `same_attendance_later`, `one_fewer_sooner`, …) — copy maps codes to sentences.
7. If nothing is eligible: return up to three near-misses with `near_miss_reason` (`quorum_short_by:n`, `required_missing:userId`) so the UI can offer lower quorum / wider window / close. A near-miss is a start at least one active member can make; when no start has anyone, the top three overall stand in, and before the first reply from an active member there are none ([ADR 0011](decisions/0011-near-misses-need-someone.md)).

Properties tested: determinism (same inputs → identical output, property-based), performance (8 members × 14 days × 30-minute starts < 50 ms in Node), DST transitions (Melbourne October and April), half-hour zones, cross-zone members, flexible-only ordering. `scoring_version` is stored with every set; changing the algorithm bumps it.

## 13. Communication pipeline

```text
domain event (outbox) → dispatcher → eligibility(recipient, kind, state) → notification_jobs (idempotent)
        → due jobs → push (Expo) | email (Resend) → receipts / webhooks → delivery events → suppression
```

- Kinds and recipients are exactly the rows on the "Push copy" artboard; the organiser receives organiser kinds by **email** when no push device exists (review C6), so Slice 1 needs no native app.
- The organiser's own **confirmed auth address becomes an `private.email_contacts` row**, created verified and with no subscription, so that organiser kinds have something to be addressed to and something to suppress on a bounce ([ADR 0027](decisions/0027-the-organisers-auth-address-is-an-email-contact.md)). `notification_jobs` addresses a contact on the email channel and never a person.
- `idempotency_key = hash(channel, recipient, plan, revision, kind, occurrence)`; the unique index makes duplicates impossible even under retry.
- Quiet hours 21:00–08:00 recipient-local: jobs are scheduled for the next 08:00 unless kind is `confirmed` or `cancelled`.
- Deadline reminder: at most one per member per plan, only to non-responders, 24 h before.
- Email templates live in `supabase/functions/_shared/email/templates/*.tsx` (React Email → HTML), matching the Emails artboard; every plan-update email carries `Stop emails for this meetup` and `Manage email preferences` links — both `/e#<token>`, with a preferences token minted for that letter ([ADR 0025](decisions/0025-the-preferences-link-is-minted-with-each-email.md)) — and a single-use re-entry link for a guest; subjects never include names beyond the circle's.
- Push payloads carry only `{kind, planId, route}`; the body text is rendered server-side from copy keys.
- Expo push receipts are fetched 15 minutes after send; `DeviceNotRegistered` disables the token.
- Resend webhook (`email-provider-webhook`): verify Svix signature, refusing everything while `RESEND_WEBHOOK_SECRET` is unset; store event once; a hard `bounced` or a `complained` → suppress the **address** immediately — every contact holding it, its subscriptions withdrawn, its queued email skipped, a tombstone by hash. A signed event we do not record is acknowledged with 200; our own failure is a 500, so the provider retries (`record_email_delivery` is idempotent).

## 14. Security and privacy architecture

| Concern | Control |
|---|---|
| Circle isolation | RLS on every public table via `auth_is_member`; pgTAP tests for member/non-member/removed/anonymous/permanent |
| Quiet-ask confidentiality | Initiator and interest rows in `private`; counts exposed only after threshold; organiser null until accepted; no initiator in events, logs, push, email, analytics; test that no public view joins `private.plan_interest` |
| Calendar data | Adapter boundary (§11) + type test + lint rule; no calendar columns anywhere in the schema |
| Email addresses | `private` schema; never in DTOs, analytics, logs; hashed for dedupe; consent version recorded |
| Invite links | ≥256-bit secret in the URL fragment; SHA-256 stored; `Referrer-Policy: no-referrer`; rotation invalidates immediately; redemption rate-limited per IP and per circle. The secret is HMAC-derived from the invite's id under `INVITE_LINK_KEY`, an Edge Function secret, so `get-invite-link` can show the owner their link again without the database holding it ([ADR 0028](decisions/0028-an-invite-secret-is-derived-so-its-owner-can-see-it-again.md)) |
| Anonymous abuse | Turnstile on web joins; Supabase anonymous IP rate limit raised to 60/hour for shared-network households; abandoned-identity cleanup |
| Tokens | Verification/preference/re-entry tokens ≥256-bit, hashed, expiring; never logged. Minted by whoever sends the thing that carries them, because a job row holds ids and no payload ([ADR 0020](decisions/0020-the-verification-token-is-minted-by-the-sender.md)). Verification and re-entry are single-use because they grant something; a preferences link is reusable, because an unsubscribe that expires on use is not one ([ADR 0019](decisions/0019-consent-is-recorded-when-it-is-given.md)) |
| Service role | Only in Edge Function secrets; never in the client or repository; CI secret scanning |
| Transport | HTTPS everywhere; HSTS on the domain; Supabase JWT expiry 1 h with refresh |
| Definer functions | `security definer` + `set search_path = ''` + explicit `revoke` from `public`; each has a pgTAP test that `anon` cannot call it where not intended |
| Logs | Structured, PII-free; request id only; Supabase log retention as per plan |
| Deletion | `delete-account` revokes sessions, anonymises memberships (display name → "Former member"), purges private data within 30 days |
| Age | Terms require 18+; no age-gating UI in MVP; no under-16 accounts by policy (review 5.5) |
| Legal | Spam Act unsubscribe ≤ 5 working days (immediate here); consent records retained; privacy policy reviewed before public launch |

## 15. Analytics

- Typed catalogue in `packages/contracts/analytics.ts`: event name → Zod payload schema → version. The client `track()` and the server `track-events` function both validate against it; unknown keys are dropped.
- Events: the spec's list plus `member_reattached`, `session_missing_on_return`, `duplicate_member_removed`, `app_nudge_shown|dismissed|tapped(moment)`, `account_claimed(moment)`, `app_first_open_linked`, `guest_started_circle`, `organiser_chased(answer)`, `cadence_prompt_recipient_role`.
- Views in `analytics`: `funnel_by_circle`, `plan_timings`, `reattach_rate`, `nudge_conversion`, `north_star_monthly` (reported and corroborated happened per activated circle). The founder diagnostics screen reads these through one definer function gated by an allowlist table.
- Nothing in `properties` may be a name, email, note, token or event title; the ingest schema is the enforcement.

## 16. Testing and CI

| Layer | Tool | What |
|---|---|---|
| Domain | Vitest + fast-check | Engine properties, state machine table, deadline/quorum defaults, window normalisation, nudge eligibility, share messages |
| Contracts | Vitest | Every Zod schema round-trips its fixture; analytics catalogue rejects PII keys |
| Database | pgTAP via `supabase test db` | Constraints, partial unique indexes, exclusion constraints, every RLS policy (allow + deny), transition function guards, retention jobs, `private` unreachable from `anon`/`authenticated`. `pnpm db:test` also measures which of the database's functions the suites actually call, with `track_functions = all` and pg_cron paused so that only the tests count, and fails on one that stops being reached — all 47 are reached today (`supabase/tests/function-coverage.txt`) |
| Functions | Vitest against the local stack | Invite → anonymous join → availability → candidates → confirm; concurrent threshold hits transition once; idempotent retries send nothing twice; webhook replay stores once |
| Web e2e | Playwright | No-install journey in mobile Safari/Chrome UAs **and** WhatsApp/Messenger in-app-browser UAs; continue-as after cleared storage; email preference links; 200% type |
| Native e2e | Maestro (Slice 3) | Calendar grant/deny/override; push tap deep link; add to calendar |
| Accessibility | axe in Playwright; manual VoiceOver/TalkBack pass per slice | Manifesto §6 |

`pnpm check` runs format, lint (incl. boundaries and copy rules), typecheck, domain/contracts tests, database reset + pgTAP, function tests, and the Playwright smoke. GitHub Actions runs it on every PR with the Supabase CLI in Docker; EAS Workflows build development clients on `main` and publish EAS Updates per channel. Migrations deploy to `dev` on merge and to `prod` by a manual, reviewed workflow.

Definition of done per feature: acceptance criteria pass; all eight screen states exist; analytics event emitted and schema-tested; RLS/database test exists; copy in `copy/`; no PII in logs; seed scenario updated; ADR written if a rule changed.

## 17. Delivery plan (infrastructure per slice)

| Slice | Product scope | Infrastructure it needs |
|---|---|---|
| **0 — Foundation** | Monorepo, tokens, components, routes with fixtures, Supabase local + migrations + seed, CI, `AGENTS.md` | Repo, Supabase CLI, GitHub Actions, EAS project, dev Supabase project, holding domain |
| **1 — Web end-to-end** | Welcome (Apple/Google/email), first-time flow, circle, invite, anonymous join with continue-as, named plan, availability (+ flexible, none-work), engine, candidates (organiser/member), confirm, confirmed pages, share messages, `.ics` + Google link, outcome and attendance, plan-update email with verification and preferences, organiser email notifications, OG route, analytics | EAS Hosting Starter + custom domain, Resend domain auth, Apple/Google sign-in configuration (web + native credentials), Turnstile, pg_cron |
| **2 — Relationship loop (web)** | Quiet ask with organiser acceptance, tonight/weekend presets, cadence + take-turns nudges, plan another, corroborated attendance, deadline-passed handling, edit/reschedule/cancel, guest → account nudges | Nothing new; more cron kinds |
| **3 — Native** | Development builds, calendar overlay, push (contextual ask), native add-to-calendar, universal links, app nudges and app landing | Apple Developer + Play accounts, EAS Build credits, AASA/assetlinks on the domain, Sentry |
| **4 — Hardening** | Rate limits and abuse tests, RLS audit, accessibility pass, DST matrix, retry UI, privacy pages, deletion, diagnostics export, product-marketing consent if still wanted | Supabase Pro, spend cap, backups verified, log retention |

## 18. Operations

- **Deploy**: migrations via `supabase db push` from CI with a reviewed plan; functions via `supabase functions deploy`; web via `eas deploy`; native via EAS Update for JS-only changes and EAS Build for native changes.
- **Rollback**: migrations are forward-only with compensating migrations; EAS Update supports channel rollback; functions redeploy from the previous tag.
- **Backups**: Pro daily backups from the external cohort onward; weekly `pg_dump` to encrypted storage before that.
- **Monitoring**: Supabase logs and function error rates; a daily `health` cron that emails the founder counts of failed jobs, bounced emails, and stuck plans; Sentry from Slice 3.
- **Incidents**: user-visible reference ids map to request ids in logs; a runbook in `docs/runbooks/` for stuck plans, suppressed contacts, and identity merges.

## 19. Decisions to record as ADRs

| ADR | Decision | Alternatives considered |
|---|---|---|
| 001 | EAS Hosting Starter with `server` output for the web app | Cloudflare Pages + Worker for OG (cheaper, second deploy path); Vercel adapter (unofficial) |
| 002 | `StyleSheet` + generated tokens, no utility CSS framework | NativeWind/Tailwind (faster iteration, but a second token vocabulary and web quirks) |
| 003 | Domain events through a Postgres outbox drained by cron, not database webhooks | Supabase database webhooks (simpler, but no ordering or retry guarantees) |
| 004 | Organiser roles require a permanent identity | Allow anonymous organisers (simpler, but session loss strands the plan) |
| 005 | Willing windows retained 12 months | 30 days (spec) — too short for circle defaults and learning |
| 006 | Continue-as reattachment without owner approval | Owner approval (safer, but adds a blocking step in a private group) |
| 007 | pnpm monorepo with `packages/domain` shared by client and Edge Functions | Separate domain copies per runtime (drift); a Node API service (ops cost) |
| 008 | React Email for templates rendered in Edge Functions | Resend hosted templates (vendor lock; harder to test) |

## 20. Open questions

1. Google sign-in on web needs an OAuth client per origin; confirm whether the holding domain will be replaced before the external cohort, since re-verification is a small but real cost.
A. Yes the holding domain will be replaced
2. Whether the founder wants Realtime on the candidates screen in Slice 1 or is happy with refetch-on-focus (Realtime adds a websocket and a free-tier quota to watch).
A. Refetch on focus is fine
3. Whether to ship the Google Calendar template URL for Android web users in Slice 1 or hold it to Slice 3 with the native add-to-calendar work.
A. Hold it till slice 3
4. Sentry from Slice 1 (small cost, better signal from the founder's own groups) versus Slice 3 as planned.
A. Hold it for now.
