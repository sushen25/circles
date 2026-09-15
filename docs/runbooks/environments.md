# Environments

What exists, where it lives, and which knob is where. The one-time setup that
creates all of this is [`environment-setup.md`](./environment-setup.md); this
file is the reference you come back to.

**No key, token or secret value belongs in this file.** Names of secrets, yes.
Values, never — this file is in the repository.

## The three environments

| | `local` | `dev` | `prod` |
|---|---|---|---|
| Supabase | CLI stack in Docker (`pnpm db:start`) | `circles-dev` (Free) | `circles-prod` (Free → Pro) |
| Web | `pnpm dev` on Metro | EAS Hosting, `dev` alias + a per-PR alias | EAS Hosting on the custom domain |
| Native | development build pointed at local or `dev` | development builds, EAS Update `development` channel | TestFlight / Play internal |
| Purpose | everyday work; every test suite runs here | integration, PR previews | real groups |
| Project ref | n/a | `pcfekupwqrdfryeaqggx` | `bhunoaqswteamabbyckp` |
| Region | your laptop | `ap-south-1` (Mumbai) | `ap-southeast-1` (Singapore) |
| Postgres | 17 (`config.toml`) | 17 | 17 |

Project refs are not secret — they are the subdomain of a public API URL. Keys
are, and none are in this file.

Both hosted projects exist and are healthy, with anonymous sign-ins and the
email provider enabled and Apple/Google not yet configured. `prod` was paused
once, on the seven-day inactivity rule below, and was resumed on 15 September
to be deployed to. Expect it again after any quiet week: a paused project
answers no API call, so configuring one fails in a way that reads like a
credentials problem.

Provider state is readable from outside at any time, which is the quickest way
to tell a misconfigured project from a broken deploy:

```bash
curl -s https://<ref>.supabase.co/auth/v1/settings -H "apikey: <anon key>" | jq .external
```

**`dev` is live and verified end to end** (8 September 2026): migrations
applied, Edge Functions deployed and answering, the web build serving on
`sushen25s-team-circles--dev.expo.app`, and an EAS Update published to the
`development` channel.

`https://pcfekupwqrdfryeaqggx.supabase.co/functions/v1/hello` returns
`{"domain":"@circles/domain","contracts":"@circles/contracts","validated":true}`,
which closes the question ADR 0007 left open: the shared domain package really
does load and run inside Deno, not only in the client and the test suites.

**`prod` is deployed** as of 15 September 2026: migrations `0001`–`0015`, all
Edge Functions, and the web build on `meet.sushensatturu.com` with a Google
Trust Services certificate. `pnpm check:env meet.sushensatturu.com` passes
seven of seven.

That is a deployed environment, **not a released product.** The client is still
fixture-driven — `/join` renders a fixture and never reads the invite secret
out of the fragment, nothing calls `redeem-invite`, `create-circle` or
`create-plan`, and `src/data/session.ts` holds a null token until S1-14 sets
one. So production serves a screen gallery in front of a complete backend.

**That is a statement about the client, not about the system — and the
difference matters.** The backend is live and publicly reachable. The bundle
served from `meet.sushensatturu.com` necessarily carries
`EXPO_PUBLIC_SUPABASE_URL` and the publishable key, email OTP is enabled, and
`disable_signup` is `false`. So anybody can sign up with any address, become a
permanent identity, and call `create-circle` directly: its guard refuses only
anonymous callers, and it answers with an `invite_secret`. From there
`redeem-invite` accepts an anonymous caller with that secret. Nothing about a
fixture-driven UI prevents any of it; rate limits (10 circles per user per
hour, 20 per IP) are the only brake.

What is true is narrower: **no invite link has been shipped**, and none can
reach anyone through the product, so §5.2's boundary — which is about links
arriving in somebody's chat — has not been crossed by deploying. The honest
summary is that production is an open backend with no front door advertised,
not a closed system.

The lever, if that is not wanted before S1-32, is `disable_signup` on
`circles-prod`: with signups off nobody new can reach a permanent identity, and
`create-circle` becomes unreachable from outside. It is a dashboard toggle and
it is reversible. It has deliberately **not** been set, so that it stays a
decision somebody made rather than a default nobody noticed.

Two settings are deliberately unset on `circles-prod`: `circles.functions_url`
and `circles.cron_secret`. Their only reader posts to `process-scheduled-jobs`,
which does not exist until S1-20, so setting them early would turn a clean
no-op into a POST to a 404 every minute. `cron.job_run_details` shows the
`process-jobs` job succeeding and returning null, which is the no-op working.

> **The two projects are in different regions.** A region cannot be changed
> after creation; moving means a new project and a new ref. That makes `dev` a
> poor latency proxy for `prod`, which matters when the candidate engine and the
> plan state machine are being judged on how quick they feel. Neither region is
> especially close to Australian users — `ap-southeast-2` (Sydney) is. Cheap to
> fix while both are empty; expensive once `prod` has real circles in it.

Free Supabase projects **pause after seven days of inactivity**, and a pg_cron
heartbeat does not prevent it — pausing is measured on API requests, not
database activity. A paused `dev` looks exactly like a broken deploy. `prod`
moves to Pro the week the first non-founder circle is recruited (§5.1).

## Domains

Both environments are **subdomains of the founder's personal apex**,
`sushensatturu.com`, which is already a Route 53 hosted zone. They are holding
hosts (§5.2, ADR 0001) and will be replaced when the product is named — nothing
may assume them.

| | Host today | Host eventually |
|---|---|---|
| `dev` | `sushen25s-team-circles--dev.expo.app` | unchanged — see below |
| `prod` | `meet.sushensatturu.com` | unchanged |

**EAS Hosting allows one custom domain per project**, assigned to the
production deployment, so the two environments cannot both have one. `meet`
takes it (founder decision, 15 September 2026) and `dev` keeps the `expo.app`
host permanently rather than temporarily. That costs nothing: §5.2 binds links
that reach a real person, and `dev` never sends an invite.

**`dev` runs without a custom domain for now** (founder decision, 8 September
2026). EAS Hosting gives every alias a stable URL of the form
`sushen25s-team-circles--<alias>.expo.app`, which is enough for integration
testing and per-PR previews.

It is not a deferral any more, it is the arrangement (founder decision, 15
September 2026). `dev` keeps the `expo.app` host permanently, because EAS
Hosting allows one custom domain per project and `meet.sushensatturu.com` takes
it.

The Turnstile widget and the OAuth clients are still configured against the
final hostname rather than the `expo.app` one, so each is created once — but
they are configured **before** the domain is attached, not after. Both store a
hostname as text and check no DNS when saved, so a settled name is all they
need. The attachment itself waits on a production deployment, and
`deploy-prod.yml` will not deploy without the Turnstile site key, so the
reverse order is a deadlock. See
[`environment-setup.md`](./environment-setup.md) steps 2 and 7.

This is not a licence to ignore §5.2. That rule — **never ship links on
`*.expo.app`** — is about links a real person receives, and it still binds
absolutely. The boundary is sharp: the first time an invite link is sent to
anybody who is not the founder, the custom domain has to exist first, because a
link already sitting in a group chat cannot be recalled. `dev` never sends
invites, so it never crosses that line.

`meet` rather than the codename, on purpose: a URL is the hardest thing to take
back, because links already sitting in a group chat keep working and keep saying
whatever they said. `meet` describes the job, so it survives the rename.

Everything user-visible reads from
[`packages/config/src/brand.ts`](../../packages/config/src/brand.ts) — app host,
sender, support address. `dev` is deliberately **not** in `brand.ts`: nothing
user-visible points at it, and it arrives through `EXPO_PUBLIC_APP_ORIGIN`.

Links are **never** shipped on `*.expo.app`.

**`prod` has an authenticated sending domain**, `mail.meet.sushensatturu.com`,
verified in Resend on 15 September — so `pnpm check:env meet.sushensatturu.com`
runs the email checks and passes them. `dev` has none and never will: it does
not send, and `--no-email` is the right invocation there.

No environment sends real email *yet* all the same, because the client that
would ask for it does not exist until S1-19. What changed is that the domain is
ready, not that anything is using it.

Email is tested **locally** instead. `pnpm db:start` runs Mailpit next to
Postgres and Auth; everything the stack sends is captured at
`http://127.0.0.1:54324` and never leaves the machine.

```bash
pnpm mail                        # what has been caught
pnpm mail someone@example.com    # that address's newest sign-in code
```

Sign-in is a **six-digit code, not a magic link** (§10). Supabase's stock
template sends `{{ .ConfirmationURL }}`, so the local stack would otherwise
exercise a flow the app does not implement; `supabase/templates/magic-link.html`
overrides it and `config.toml` points at it. Verified end to end: request an OTP,
read the code out of Mailpit, `/auth/v1/verify` returns a session.

The hosted projects still carry Supabase's stock templates in their dashboards.
They send links, and they will keep sending links until the email ticket lands —
which is fine while nothing hosted signs anyone in, and a trap the moment
something does.

DNS records live **inside the existing `sushensatturu.com` hosted zone** — never
a new zone per subdomain. Names are as typed in the Route 53 console, which
appends the zone for you:

| Record | Name | Purpose |
|---|---|---|
| app | `meet`, `dev` | EAS Hosting; take the exact target from its dashboard |
| SPF + bounce MX | `send.mail.meet` | **A CNAME to `send.forge.rmta.net`**, not records of its own — Resend delegates, and resolution follows it to a `v=spf1 … ~all` TXT and an MX at `feedback.forge.rmta.net`. Both answer at `send.mail.meet`, which is all `check:env` and every receiving server care about. Without the MX, Resend cannot tell a hard bounce from silence and the suppression list never fills |
| Return path | `rsend.mail.meet` | CNAME to `rsend-apne1.forge.rmta.net`. **`rsend` is not a typo of `send`**; they are separate records and both are required |
| DKIM (TXT) | `resend._domainkey.mail.meet` | Resend's key, on the sending domain itself — the name that has to align with the header `From` |
| DMARC (TXT) | `_dmarc.mail.meet` | `p=none` at first, `p=quarantine` after warm-up. No `rua=`: a reporting address on a domain you do not control needs a `_report._dmarc` authorisation record there (RFC 7489 §7.1), and Gmail publishes none — see `environment-setup.md` step 5 |

Nothing else may ever be added at `send.mail.meet` or `rsend.mail.meet`: a
CNAME cannot coexist with another record at the same name.

`support@meet.sushensatturu.com` is in `brand.ts` but **nothing receives mail
there** — the zone has no MX for it. Arrange forwarding before any email
carrying that address goes out, or a reply from a real person disappears.

`.well-known/` on each app host is reserved for `apple-app-site-association` and
`assetlinks.json` — Slice 3, but do not let anything else claim the path.

Paths reserved on the domain (§5.2), so nothing else may take them:
`/join`, `/j/<code>`, `/p/<code>`, `/a/<token>`, `/e/<token>`, `/v/<token>`.

## Configuration, and the line secrets do not cross

Public values ship inside the client bundle and are readable by anyone who
opens the app. Secrets never leave Edge Function config (§5.3).

**Public — `EXPO_PUBLIC_*`, listed in [`.env.example`](../../.env.example):**
`EXPO_PUBLIC_APP_ENV`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`,
`EXPO_PUBLIC_APP_ORIGIN`, `EXPO_PUBLIC_TURNSTILE_SITE_KEY`.

In CI these are GitHub Actions **variables**, not secrets, because calling a
value secret when it is printed in the page source teaches people the word means
nothing. The scoping does the environment split:

- **Repository variables** hold the `dev` values. `preview` (per-PR) and
  `deploy-dev` both read them, so previews point at `dev` and never at
  production data.
- **`production` environment variables** hold the live values and override the
  repository ones for `deploy-prod` only.

`scripts/check-client-env.mjs` runs before the `dev` and `prod` deploys and
fails if one is missing or malformed. **Not before per-PR previews**, on
purpose: a preview exists to look at screens, which are fixture-driven and need
no backend, and a guard there would turn every PR red for a variable the PR did
not change. An `expo export` with no Supabase URL builds and deploys
perfectly happily, and every request fails in the browser.

**Secret — set with `supabase secrets set`, on both projects:**

| Name | From |
|---|---|
| `RESEND_API_KEY` | Resend → API Keys |
| `RESEND_WEBHOOK_SECRET` | Resend → Webhooks, on the endpoint |
| `TURNSTILE_SECRET_KEY` | Cloudflare → Turnstile, pairs with the site key. **The name matters:** `_shared/turnstile.ts` reads exactly this, and skips the check when it is unset rather than failing — so a secret stored under any other name leaves web joins unverified and looks configured |
| `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`, `APPLE_SERVICES_ID` | Apple Developer |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Cloud → Credentials |

The service-role key is never set by hand: Supabase injects it into functions.
It must not appear in the client or the repository (§14). gitleaks runs on every
PR; a green run is evidence, not a formality.

**Database settings the cron job reads — set once per project, after the first
deploy, never in a migration** (`0007_cron_retention.sql` explains why):

```sql
alter database postgres set circles.functions_url = 'https://<ref>.supabase.co/functions/v1';
alter database postgres set circles.cron_secret = '<the same value as CRON_SECRET>';
```

`CRON_SECRET` is also set with `supabase secrets set`, because the internal
functions compare the bearer they receive against it — `process-scheduled-jobs`,
and `recalculate-candidates`, which the dispatcher calls for a plan whose inputs
changed with no request of its own to run in. Until it is set they refuse every
call, which is the safe direction: an internal endpoint anybody can reach
because a secret is missing is worse than one nobody can reach. Until both
settings exist the minute job is a no-op — `jobs.invoke_process_scheduled_jobs()`
returns null and makes no call — so a fresh project or a local stack does not
log a failed HTTP call every minute. To check a project: run the function by
hand and read `cron.job_run_details` for the `process-jobs` job.

A database setting is readable by any role that can open a connection, so this
one guards only the cron → function hop and is not the service-role key. The
job command in `cron.job` calls the definer function rather than spelling the
header out, and the function is executable by nobody but the owner.

## The EAS account

The project, the paid plan and the CI robot must all be on **`sushen25s-team`**.
They started out split — `eas init` created the project on the personal account
while the robot was created on the organisation — and every deploy failed with
`Entity not authorized: AppEntity[...] (viewer = RobotViewerContext)`, a message
that names the app but never the viewer, so the role looked wrong when the
account was.

`owner` in `app.config.ts` now states the account, so a mismatch is an explicit
error rather than a silent one. Every deploy step runs `eas whoami` first and
prints the identity and its accounts; that line is the fastest way to tell a
wrong role from a wrong account.

**GitHub secrets** (deploy credentials, genuinely secret):
`SUPABASE_ACCESS_TOKEN`, `SUPABASE_DEV_PROJECT_REF`, `SUPABASE_PROD_PROJECT_REF`,
`EXPO_TOKEN`.

**Setting `EXPO_TOKEN` is what switches the deploy workflows on.** Until it
exists they skip and report; the moment it is set they run for real, and
`check-client-env.mjs` fails the job if the `EXPO_PUBLIC_*` variables are not
there yet. Set the variables first, then the token — in the other order the next
push to `main` goes red for a reason that has nothing to do with the commit.

Every deploy workflow is guarded on its secret being present and **succeeds**
while the secret is absent, saying what is missing in the run summary. A red
cross for infrastructure nobody has set up yet teaches people to ignore red
crosses.

## Checking it from the outside

```bash
pnpm check:env <domain>
```

HTTPS, HSTS, `Referrer-Policy: no-referrer`, and SPF/DKIM/DMARC on `mail.<domain>`
— queried against 1.1.1.1 rather than the system resolver, because a local cache
will cheerfully serve a record that was deleted an hour ago. Not part of
`pnpm check`: it needs the network and a domain that exists.

HSTS comes from EAS Hosting. **`Referrer-Policy` comes from the app**, set by
the `expo-router` plugin in [`apps/app/app.config.ts`](../../apps/app/app.config.ts),
because EAS Hosting has no header configuration and sets none of its own. It
applies to every HTML and API-route response, which is everything that can
carry an invite secret in the fragment or a plan code in the path; it does not
apply to redirects or to static assets, neither of which carries either. A
route that sets the header itself takes precedence, so a server route is free
to be stricter and cannot accidentally be laxer than this.

## Expected security-advisor warnings

`get_advisors(type: "security")` on a hosted project reports four warnings that
are **correct and expected**. Check any new one against this list before
treating it as a finding:

| Warning | Why it is fine |
|---|---|
| `auth_is_member` executable by `anon` and `authenticated` | Ours, and deliberate. The RLS policies call it, so it carries `revoke all … from public` followed by an explicit grant to exactly those two roles (§14). It is a stub returning `false` until S1-07 — it fails closed. |
| `rls_auto_enable` executable by `anon` and `authenticated` | Not ours. A Supabase platform event-trigger function that auto-enables RLS on new public tables. It reads `pg_event_trigger_ddl_commands()`, so a direct call outside a DDL event does nothing. |
| Anonymous access policies on `cron.job`, `cron.job_run_details` | pg_cron's own tables, created by the extension. |
| Leaked-password protection disabled | There are no passwords. Sign-in is a six-digit code or an OAuth provider (§10). |

Anything **outside** this table is a real finding. Re-check after every migration
that adds a definer function or a table.

## Cost

| | Now | Later |
|---|---|---|
| Supabase | US$0 (Free ×2) | US$25/mo Pro on `prod` before the external cohort |
| EAS | US$19/mo Starter | — |
| Resend | US$0 | — |
| Domain | ~US$20/yr | replaced when the product is named |
| Apple / Google | — | US$99/yr + US$25 once, Slice 3 |

Run-rate today: **US$19/month**. Set a spend cap when Supabase moves to Pro.

## When the domain changes

It will — the holding domain is temporary. In order:

1. `brand.ts`: `domain`, `sender`, `supportEmail`.
2. DNS on the new domain: all four records above.
3. Resend: add and verify the new sending domain; the old one keeps working
   until deleted, so verify before deleting.
4. EAS Hosting: attach the new domain.
5. Turnstile: the widget is bound to a hostname — add the new one. The
   `expo.app` host stays on the widget too; `dev` is always reached that way.
6. **Google OAuth: the web client must be re-created.** Authorised origins can
   be edited, but a client that has been live on the old origin carries consent
   grants tied to it; re-create rather than edit.
7. Apple: update the Services ID's return URLs.
8. `EXPO_PUBLIC_APP_ORIGIN` in the GitHub variables, both scopes.
9. `pnpm check:env <new domain>`.
