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

The deploy smoke check needs no dedicated function. An empty body to
`track-events` is refused by the schema and says so:

```bash
curl -s -w '\n%{http_code}\n' -X POST https://<ref>.supabase.co/functions/v1/track-events \
  -H 'content-type: application/json' -d '{}'
# {"error":"invalid_request","message":"Not usable: events.","reference":"…"}
# 400
```

A `400` with that JSON body means the bundle booted, the import map resolved and
`@circles/contracts`' zod schema ran inside Deno, which is the question ADR 0007 left
open. A `503` or `BOOT_ERROR` means the bundle did not boot, and a `404` that
the function is not deployed. Nothing is written.

**`prod` is deployed** as of 15 September 2026: migrations `0001`–`0015`, all
Edge Functions, and the web build on the custom domain of the day (since
moved to `wenna.app`, SUS-99; `pnpm check:env wenna.app` should pass eleven of
eleven once its records are in).

That is a deployed environment, **not a released product.** Two things are true
and they are different. The *repository* has the real client: `/join` reads the
invite secret out of the fragment and calls `redeem-invite`, and the screens call
`create-circle`, `create-plan` and the rest (S1-14 to S1-24). The *deployed
build* is whatever `deploy-prod` last shipped, and it ships the commit it is
dispatched on (in practice `main`), so production now serves that client, not a screen gallery. What has not happened is the
release itself (SUS-48): no real group has been invited, so no link has reached
anyone through the product.

**That is a statement about the client, not about the system — and the
difference matters.** The backend is live and publicly reachable. The bundle
served from the production host necessarily carries
`EXPO_PUBLIC_SUPABASE_URL` and the publishable key, email OTP is enabled, and
`disable_signup` is `false`. So anybody can sign up with any address, become a
permanent identity, and call `create-circle` directly: its guard refuses only
anonymous callers, and it answers with an `invite_secret`. From there
`redeem-invite` accepts an anonymous caller with that secret. Nothing about the
client prevents any of it; rate limits (10 circles per user per
hour, 20 per IP) are the only brake.

What is true is narrower: **no invite link has been shared with a real group**
(SUS-48 is open), so §5.2's boundary — which is about links
arriving in somebody's chat — has not been crossed by deploying. The honest
summary is that production is an open backend with no front door advertised,
not a closed system.

The lever, if that is not wanted before S1-32, is `disable_signup` on
`circles-prod`: with signups off nobody new can reach a permanent identity, and
`create-circle` becomes unreachable from outside. It is a dashboard toggle and
it is reversible. It has deliberately **not** been set, so that it stays a
decision somebody made rather than a default nobody noticed.

The minute job does nothing until two Vault secrets exist on the project,
`circles_functions_url` and `circles_cron_secret` ("Vault secrets the cron job
reads", below). Create them only once `process-scheduled-jobs` is deployed;
before that they would turn a clean no-op into a POST to a 404 every minute.
`cron.job_run_details` shows the `process-jobs` job succeeding and returning
null while they are missing, which is the no-op working.

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

Production's host is the apex **`wenna.app`**, in its own Route 53 hosted zone
(SUS-99). It is the product's name, not a holding host: once the first invite
link reaches somebody who is not the founder, it is permanent, and any later
change of host needs the old one kept answering with a redirect for as long as
those links matter (the header of
[`brand.ts`](../../packages/config/src/brand.ts) says the same).

| | Host |
|---|---|
| `dev` | `sushen25s-team-circles--dev.expo.app`, permanently |
| `prod` | `wenna.app` |

**EAS Hosting allows one custom domain per project**, assigned to the
production deployment, so the two environments cannot both have one.
Production takes it and `dev` keeps the `expo.app` host for good. That costs
nothing: §5.2 binds links that reach a real person, and `dev` never sends an
invite. EAS Hosting gives every alias a stable URL of the form
`sushen25s-team-circles--<alias>.expo.app`, which is enough for integration
testing and per-PR previews.

The apex is attached with an **A record**, not a CNAME: Route 53 cannot put a
CNAME, or an ALIAS to a non-AWS target, at an apex, and EAS Hosting supports
apex domains this way. `.app` is on the HSTS preload list, so nothing under it
is ever reachable over plain HTTP.

The Turnstile widget and the OAuth clients are configured against the final
hostname rather than the `expo.app` one, so each is created once — and
**before** the domain is attached, not after. Both store a hostname as text and
check no DNS when saved, so a settled name is all they need. The attachment
itself waits on a production deployment, and `deploy-prod.yml` will not deploy
without the Turnstile site key, so the reverse order is a deadlock. See
[`environment-setup.md`](./environment-setup.md) steps 2 and 7.

This is not a licence to ignore §5.2. That rule — **never ship links on
`*.expo.app`** — is about links a real person receives, and it binds
absolutely. The first time an invite link is sent to anybody who is not the
founder, the custom domain has to exist first, because a link already sitting
in a group chat cannot be recalled. `dev` never sends invites, so it never
crosses that line.

Everything user-visible reads from
[`packages/config/src/brand.ts`](../../packages/config/src/brand.ts) — app host,
sender, support address. `dev` is deliberately **not** in `brand.ts`: nothing
user-visible points at it, and it arrives through `EXPO_PUBLIC_APP_ORIGIN`.

**Emails load their images from the app origin** (SUS-98): every email's header
is `<origin>/brand/wenna-lockup-2x.png`, and the link-preview card and favicons
come from `apps/app/public/` too. So the app host must keep serving
`/brand/*.png` for as long as sent emails sit in inboxes. One more reason the
host, once real mail has gone out, does not change.

**`prod` sends from `mail.wenna.app`**, a separate authenticated subdomain, and
`pnpm check:env wenna.app` runs the email checks against it. `dev` has none and
never will: it does not send, and `--no-email` is the right invocation there.

The repository sends *product* email: S1-19 brought the templates, the sender
(`supabase/functions/_shared/email/`) and `email-provider-webhook`, and S1-20's
dispatcher calls them. The deployed `prod` has all of it. What is still true of
production is that no real group has been invited (SUS-48), so no letter has
gone to a person outside the founder's own testing.

**Supabase Auth is a different sender, and it is already live.** Sign-in codes
do not go through Resend; the hosted project sends them itself. With email OTP
enabled, `disable_signup` false and the publishable key readable in the bundle,
anyone can POST to `/auth/v1/otp` and make `circles-prod` send a real email to
a real address. Two things follow, and neither is hypothetical:

- What it sends is Supabase's **stock magic-link** template, not the six-digit
  code the product implements — so the first email production ever sends is one
  the app cannot handle. `supabase/templates/magic-link.html` overrides this
  locally and the hosted dashboards are untouched.
- It is rate-limited hard on the Free plan and the quota is shared, so it is
  also a way for someone else to exhaust it.

Fix the hosted templates when S1-19 lands, or turn `disable_signup` on until
then; see the deployment note above for the same lever.

Email is tested **locally** instead. `pnpm db:start` runs Mailpit next to
Postgres and Auth; everything the stack sends is captured at
`http://127.0.0.1:54324` and never leaves the machine.

```bash
pnpm mail                        # what has been caught
pnpm mail someone@example.com    # that address's newest sign-in code
pnpm email:preview               # every product email, rendered and delivered here
```

**Product email lands there too.** `config.toml` sets `EMAIL_CAPTURE_URL` to
Mailpit for every local stack (`[edge_runtime.secrets]`), and the sender prefers
it to `RESEND_API_KEY` — so a local stack cannot reach Resend even with a real
key in the shell. **No hosted project may set it.** `circles-prod` got it on
23 September 2026 by running `supabase secrets set` from inside the repository,
which also sends `config.toml`'s `[edge_runtime.secrets]`; `make secret` runs
the CLI from an empty directory so that cannot happen again
([`environment-setup.md`](./environment-setup.md) step 9).

Sign-in is a **six-digit code, not a magic link** (§10). Supabase's stock
template sends `{{ .ConfirmationURL }}`, so the local stack would otherwise
exercise a flow the app does not implement; `supabase/templates/magic-link.html`
overrides it and `config.toml` points at it. Verified end to end: request an OTP,
read the code out of Mailpit, `/auth/v1/verify` returns a session.

The hosted projects still carry Supabase's stock templates in their dashboards.
They send links, and they will keep sending links until the email ticket lands —
which is fine while nothing hosted signs anyone in, and a trap the moment
something does.

DNS records live **inside the `wenna.app` hosted zone** — never a new zone per
subdomain. Names are as typed in the Route 53 console, which appends the zone
for you (blank is the apex):

| Record | Name | Purpose |
|---|---|---|
| app | *(apex)* `A`, plus `_cf-custom-hostname` TXT and `_acme-challenge` CNAME | EAS Hosting; take the exact values from its dashboard |
| SPF + bounce MX | `send.mail` | **A CNAME to `send.forge.rmta.net`**, not records of its own — Resend delegates, and resolution follows it to a `v=spf1 … ~all` TXT and an MX at `feedback.forge.rmta.net`. Without the MX, Resend cannot tell a hard bounce from silence and the suppression list never fills |
| Return path | `rsend.mail` | CNAME to `rsend-<region>.forge.rmta.net`. **`rsend` is not a typo of `send`**; they are separate records and both are required |
| DKIM (TXT) | `resend._domainkey.mail` | Resend's key, on the sending domain itself — the name that has to align with the header `From` |
| DMARC (TXT) | `_dmarc.mail` | `p=none` at first, `p=quarantine` after warm-up. `rua=` only to a reporting service that publishes the `_report._dmarc` authorisation (RFC 7489 §7.1); Gmail publishes none — see `environment-setup.md` step 5 |
| Receiving | *(apex)* `MX` | the forwarding service's, so `hello@wenna.app` (`brand.supportEmail`, the `Reply-To` of every product email) reaches the founder's inbox |

Nothing else may ever be added at `send.mail` or `rsend.mail`: a CNAME cannot
coexist with another record at the same name.

`.well-known/` on each app host is reserved for `apple-app-site-association` and
`assetlinks.json` — Slice 3, but do not let anything else claim the path.

Paths reserved on the domain (§5.2), so nothing else may take them:
`/join`, `/j/<code>`, `/p/<code>`, `/a`, `/e`, `/v` (the last three carry their token in the fragment, `/a#<token>`, which the host never sees — ADR 0023).

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

**The server routes do not see these variables on EAS Hosting** (SUS-128).
Metro inlines `EXPO_PUBLIC_*` into the client bundle only; the link-preview
middleware and `/og/[kind]` read `process.env` at run time, and the run-time
environment is what `eas deploy` uploads — the app's `.env*` files, plus EAS
environment variables when `--environment` is passed. The workflows set the
values in the shell, which is neither, and `eas env:list` is empty for every
environment. So the server reads the app config instead, which
babel-preset-expo inlines into server bundles too in place of
`process.env.APP_MANIFEST`: a production card takes its origin and its
Supabase pair from `app.config.ts`'s `extra` as the export evaluated it, falls
back to `https://${brand.domain}`, and never names a `*.expo.app` host.
`dev` and previews keep the request's own origin, which is the host they are
served on. See `apps/app/src/data/preview-origin.ts`.

**Secret — set with `make secret` (never `supabase secrets set` from inside the repository; see `EMAIL_CAPTURE_URL` below). Not the same set on both projects**,
which is the part that gets got wrong in both directions. `make secret ENV=dev
K=NAME` and `make secrets ENV=prod` (names and digests, never values)
supply the project ref for you, so the environment is named rather than
copied. `make secret` reads the value from stdin (a hidden prompt at a
terminal, or piped: `pbpaste | make secret ENV=dev K=NAME`) and refuses `V=`,
which would put it in shell history and in an agent's transcript. With
`GENERATE=1` the value is invented with `openssl rand` and shown to nobody,
which suits a secret nothing else has to agree with:

| Name | From | `dev` | `prod` |
|---|---|---|---|
| `CRON_SECRET` | **nobody — you invent it.** Its only job is that `jobs.invoke_process_scheduled_jobs()` and `_shared/internal.ts` agree on it. It cannot be read back, and the Vault secret `circles_cron_secret` needs the same string | own value | own value |
| `INVITE_LINK_KEY` | **nobody — you invent it**: `openssl rand -base64 32`. Invite secrets are derived with it so the owner can see their link again ([ADR 0028](../decisions/0028-an-invite-secret-is-derived-so-its-owner-can-see-it-again.md)). **Optional, and quiet when missing**: links are still made, but only a reset gets the owner a link back. Changing it later makes every existing link unshowable (they keep working): to change it *because it leaked*, follow "The invite key has leaked" below instead of just setting a new value. Local stacks set it in `config.toml` | own value | own value |
| `CALENDAR_LINK_KEY` | **nobody — you invent it**: `openssl rand -base64 32`. `generate-ics` signs the short-lived token a calendar link carries with it, so one tap on an iPhone opens the system Add to Calendar ([ADR 0063](../decisions/0063-the-calendar-file-is-served-at-a-link-with-a-short-lived-signed-token.md)). **Optional, and quiet when missing**: with no key no token is made and the app fetches the file with the bearer instead (four taps on an iPhone, not one). Changing it only ends links already minted, and they last 15 minutes. Local stacks set it in `config.toml` | own value | own value |
| `TURNSTILE_SECRET_KEY` | Cloudflare → Turnstile, pairs with the site key. **The name matters:** `_shared/turnstile.ts` reads exactly this, and on a hosted project refuses with 503 when it is unset (it skips the check only off-hosted, see `CIRCLES_ENV`) — so a secret stored under any other name makes every web join fail rather than pass unverified | the **dummy** `1x0000000000000000000000000000000AA`, pairing with the dummy site key at repository scope | the real one |
| `CIRCLES_ENV` | `hosted` or `local`, **you choose**. Says whether `_shared/turnstile.ts` should refuse a web join when `TURNSTILE_SECRET_KEY` is missing (hosted) or skip the check (local), and whether `_shared/email/resend.ts` refuses `EMAIL_CAPTURE_URL` (hosted) or honours it (local); never set `local` on a hosted project. **Optional, and safe when missing**: without it a function judges from `SUPABASE_URL` and treats anything that is not `localhost`, `127.0.0.1`, `kong` or `host.docker.internal` as hosted, so a custom domain fails closed. Set `hosted` anyway so the answer is a statement rather than an inference | `hosted` | `hosted` |
| `TURNSTILE_ALLOWED_HOSTNAMES` | Comma-separated hostnames a solved challenge may name, e.g. the production app host. Cloudflare reports where the widget was solved; with this set, a good token solved anywhere else is refused. **Optional**: unset, the hostname is not checked. Leave it unset on `dev`, whose dummy key reports a placeholder hostname | unset | the app's host |
| `EMAIL_CAPTURE_URL` | **never on a hosted project.** Local only, from `config.toml`. Set on one, it wins over `RESEND_API_KEY` and every product email goes to a catcher that is not there | never | never |
| `RESEND_API_KEY` | Resend → API Keys | **never** — `dev` does not send | yes |
| `HEALTH_REPORT_TO` | **you choose** — where the dispatcher's daily health summary goes. Optional: with no address the summary is a structured log line and an `audit_log` row, which is where `dev` should leave it. Counts, one route pattern (`/p/:code`, never an address) and two timestamps; never an identifier | never | yes |
| `RESEND_WEBHOOK_SECRET` | Resend → Webhooks → the `email-provider-webhook` endpoint → signing secret (`whsec_…`). **Without it the webhook refuses every event** (fails closed), so bounces go unrecorded and the suppression list never fills | never | yes |
| `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`, `APPLE_SERVICES_ID` | Apple Developer | S1-14b | S1-14b |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Cloud → Credentials | S1-14b | S1-14b |

A real Turnstile secret on `dev` fails every web join there; a Resend key on
`dev` gives an environment that is not supposed to send the means to. Both look
configured.

The service-role key is never set by hand: Supabase injects it into functions.
It must not appear in the client or the repository (§14). gitleaks runs on every
PR; a green run is evidence, not a formality.

**Vault secrets the cron job reads — created once per project, after
`process-scheduled-jobs` is deployed, never in a migration.** Run in the
project's SQL editor (Dashboard → SQL Editor), which connects as `postgres`:

```sql
select vault.create_secret('https://<ref>.supabase.co/functions/v1', 'circles_functions_url');
select vault.create_secret('<the same value as CRON_SECRET>', 'circles_cron_secret');
```

To change one later, `select vault.update_secret(id, '<new value>') from
vault.secrets where name = 'circles_cron_secret';`. Rotate `CRON_SECRET` and
`circles_cron_secret` together: until both match, every call is refused with a
401.

**Not database settings.** Until SUS-127 these were `circles.functions_url` and
`circles.cron_secret`, set with `alter database postgres set …`. A hosted
project refuses that (`42501: permission denied to set parameter`), because its
`postgres` role is not a superuser, so the job was a no-op on every hosted
project until then.

`CRON_SECRET` is also an Edge Function secret (`make secret`), because the internal
functions compare the bearer they receive against it — `process-scheduled-jobs`
and `recalculate-candidates`. **A local stack sets it in `config.toml` instead,
to the word `local`** (`[edge_runtime.secrets]`, beside `EMAIL_CAPTURE_URL`):
without it the one background worker refuses every call on the one environment
where it can be watched. The two Vault secrets above are still left out
locally, so nothing invokes it until somebody does so by hand. Until `CRON_SECRET` is set the functions refuse every
call, which is the safe direction: an internal endpoint anybody can reach
because a secret is missing is worse than one nobody can reach. Until both
Vault secrets exist the minute job is a no-op — `jobs.invoke_process_scheduled_jobs()`
returns null and makes no call — so a fresh project or a local stack does not
log a failed HTTP call every minute. To check a project: run the function by
hand and read `cron.job_run_details` for the `process-jobs` job.

Vault keeps the values encrypted at rest, and only `postgres` and roles it
grants can read `vault.decrypted_secrets`. Even so, the bearer guards only the
cron → function hop and is not the service-role key. The job command in
`cron.job` calls the definer function rather than spelling the header out, and
the function is executable by nobody but the owner.

### The invite key has leaked

`INVITE_LINK_KEY` derives every invite secret (HMAC of the invite's id, [ADR 0028](../decisions/0028-an-invite-secret-is-derived-so-its-owner-can-see-it-again.md)). The key alone is not enough to open a circle: the digest in the database and the invite ids are not readable by a client, so a leak is a risk to confirm, not an open door. But rotating the key by itself changes nothing that matters, because the old links keep working and merely stop being showable. Do this:

1. Invent the new key: `openssl rand -base64 32`. Keep it in your shell only.
2. **Set it on the project first**: `make secret ENV=<env> K=INVITE_LINK_KEY` (paste the new key at the prompt). From then on every link an owner creates or resets is derived under the new key, so nothing made while the sweep runs can slip past it. Until the sweep finishes, owners are offered a reset instead of their link, because the live link was derived under the old key.
3. Dry run against the project (reads, counts, changes nothing). The service role key is under Dashboard → Settings → API Keys:

   ```bash
   SUPABASE_URL=https://<ref>.supabase.co \
   SUPABASE_SERVICE_ROLE_KEY=<service role key> \
   INVITE_LINK_KEY_NEW=<the new key> \
   node scripts/rotate-invite-key.mjs --hosted
   ```

4. Apply it with `--apply`. Every circle with a live invite under the old key gets a new one derived under the new key, and the old one is revoked in the same statement. It sweeps again until a pass finds nothing left, and says so. It is safe to run twice: an invite already under the new key is skipped. If it reports invites under another key after three passes, the secret in step 2 has not reached the functions: check it, then run it again. It prints counts only.
5. Tell the owners. Every link already shared is dead: they open the circle's settings and share the link again. Nothing else changes for members, who are already in. The audit log has one `circles.invite_reissued` row per circle, with no actor.

Rehearse it on a local stack first (`http://127.0.0.1:54321`, the key in `supabase/config.toml`, no `--hosted`). The database half is `public.reissue_invite`, callable by `service_role` alone.

## The invite digest key (SUS-214)

`INVITE_DIGEST_KEY` is the key a new invite secret's and emailed re-entry token's stored digest is an HMAC under ([ADR 0081](../decisions/0081-invite-and-re-entry-digests-are-an-hmac-under-a-key-only-the-functions-hold.md)), so a copy of the database cannot reproduce one. It is not `INVITE_LINK_KEY` (which derives the secret, is optional and has its own leak runbook above) and is a different value on purpose. Local stacks set it in `config.toml`.

**Required, and it fails closed.** Without it creating or resetting a link, joining, the Join page's preview, an emailed way back in and every letter carrying a re-entry link answer 503 (or are retried by the dispatcher), and nothing falls back to a plain SHA-256. A hosted value shorter than 32 characters is refused too, so a stray `local` cannot protect a hosted project.

**Founder to-do, before the SUS-214 code is deployed to each project** (`dev` first, then `prod`): set the secret. `make secret` invents a fresh 32-byte value, shows it to nobody, and runs `supabase secrets set` from an empty directory so the repository's `config.toml` secrets are not sent with it:

```bash
make secret ENV=dev K=INVITE_DIGEST_KEY
make secret ENV=prod K=INVITE_DIGEST_KEY
# what it runs, from an empty directory:
# supabase secrets set --project-ref <ref> INVITE_DIGEST_KEY="$(openssl rand -base64 32)"
```

Check with `make secrets ENV=<env>` that the name is listed. Deploying first and setting it after leaves links and letters answering 503 in between.

**Links made before it keep working** (`digest_kind = 'sha256'`). Count the invites still on the old digest with `select count(*) from circle_invites where digest_kind = 'sha256' and revoked_at is null;`. Re-entry links expire seven days after the deploy; invites last until their owner resets them. To end the old path sooner, run `scripts/rotate-invite-key.mjs` as in "The invite key has leaked" with `INVITE_LINK_KEY_NEW` set to the key the project already has and `INVITE_DIGEST_KEY` set to the digest key: every old link in a group chat then stops working until its owner shares the new one. The digest key does not rotate in place (a new value ends every link made since); after a leak, set the new value and run the same sweep with it.

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

**GitHub secrets** (deploy credentials, genuinely secret), in two sets:

- **Repository scope, dev and previews:** `SUPABASE_ACCESS_TOKEN`,
  `SUPABASE_DEV_PROJECT_REF`, `EXPO_TOKEN`. Every same-repo branch can read
  these, so none of them may reach production.
- **`production` environment, only after the required reviewer approves:**
  `SUPABASE_PROD_ACCESS_TOKEN`, `SUPABASE_PROD_PROJECT_REF`, `EXPO_PROD_TOKEN`.

The names differ on purpose, and `check:workflows` enforces the split; why, the
caveats that remain, and how to rotate them are in
[`ci.md`](./ci.md), under "Deploy credentials".

**Setting `EXPO_TOKEN` is what switches the deploy workflows on.** Until it
exists they skip and report; the moment it is set they run for real, and
`check-client-env.mjs` fails the job if the `EXPO_PUBLIC_*` variables are not
there yet. Set the variables first, then the token — in the other order the next
push to `main` goes red for a reason that has nothing to do with the commit.

`deploy-dev` and `preview` are guarded on their secrets being present and
**succeed** while one is absent, saying what is missing in the run summary. A
red cross for infrastructure nobody has set up yet teaches people to ignore red
crosses. `deploy-prod` fails instead: a production deploy that deployed nothing
must not look like one that did.

## Settings only the founder can change (to do)

Nothing in the repository can set these, and no agent may: they are hosted
project and repository settings. Each is written down here so it is a known
gap with an owner, not a surprise.

- [ ] **Enforce SSL on the database connection, on both projects.** Dashboard,
  Database, Settings, SSL configuration, "Enforce SSL on incoming connections".
  It is off today. The Supabase CLI and the pooler connect with TLS already, so
  this is safe to switch on; `psql` by hand needs `sslmode=require`.
- [ ] **Database network restrictions, on `circles-dev` and `circles-prod`.**
  Both projects allow `0.0.0.0/0` and `::/0`. Nothing in the product connects
  to Postgres directly (the app and the functions go through the API gateway),
  **but the deploy workflows do: `supabase db push --linked` in `deploy-dev`
  and `deploy-prod` connects to the database from a GitHub-hosted runner, whose
  addresses are not fixed.** So "restrict to nothing" would turn every deploy
  red. Decide knowingly: keep the open range and lean on enforced SSL and the
  database password, or restrict to the founder's own address and move
  migrations to a runner with a fixed address first. Whichever it is, record the
  choice here.
- [ ] **A branch policy on the `dev` GitHub environment.** It has none, so
  `deploy-dev` can be dispatched from any branch and that branch's workflow
  file runs with the dev credentials. Settings, Environments, `dev`,
  "Deployment branches": selected branches, `main` only.
- [ ] **`production`: its approval is a pause, not a review.** The required
  reviewer is the founder and the environment allows self-review and admin
  bypass, so the approval on `deploy-prod` gives the person who dispatched the
  deploy a moment to read the migration plan, and nobody else sees it. Turn off
  "Allow administrators to bypass protection rules" and add a second reviewer
  if that is ever not enough.
- [ ] **Revoke the old dev Resend key**, now that dev's Auth SMTP sender is on
  `mail.wenna.app` (14 October).

## Checking it from the outside

```bash
pnpm check:env <domain>
```

Two requests, each held to its own headers. **`/start`, an app route:** HTTPS,
HSTS, `Referrer-Policy: no-referrer`, a `Content-Security-Policy` (with
no `unsafe-inline` or `unsafe-eval` for scripts, and `frame-ancestors 'none'`),
`X-Content-Type-Options: nosniff` and a `Permissions-Policy`. **`/`, the
website (ADR 0052):** HSTS, `strict-origin-when-cross-origin`, a policy with
`default-src 'none'`, no script and `frame-ancestors 'none'`, and nosniff. Then
SPF/DKIM/DMARC on `mail.<domain>`
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

The same block carries the other three (SUS-119), built by
[`packages/config/src/securityHeaders.ts`](../../packages/config/src/securityHeaders.ts).
The policy allows scripts from the app's own origin, from Cloudflare's
Turnstile, and the one inline script Expo Router writes into every page — by a
hash `app.config.ts` computes from that script, never typed. The live suite
reads the script out of the served HTML and checks its hash is in the header, so
a router upgrade that changes it fails a test instead of blanking the app.
`connect-src` names the Supabase project from `EXPO_PUBLIC_SUPABASE_URL` at
build time. Styles are `'unsafe-inline'`, because `react-native-web` writes
them inline; that is the one concession. A page that needs a new origin (an
analytics host, an embed) must add it there, and the live suite fails on any
console message from the policy, so the omission is found before a deploy does.
`deploy-prod` runs `check:env` after it deploys, so a **rollback to a release
older than SUS-119 ends red** on these three checks, and one older than the website's own headers (ADR 0052) on the `/` checks too; the rollback itself is not
undone by it.

**Dev routes.** Everything under `app/(dev)` (the gallery, the brand sheet, the
fixture screens, `/settings/diagnostics`) answers not-found when
`EXPO_PUBLIC_APP_ENV` is `production`. `/_sitemap` is left out of every export
whose `EXPO_PUBLIC_APP_ENV` is not `development` (the plugin's `sitemap: false`),
so production and previews answer 404. A deployed `dev` is built as
`development` and still lists its routes; closing that needs a build flag
`deploy-dev` does not set yet (SUS-192). Other
deployed environments redirect the fixtures to `/start` (SUS-140), and the
smoke export keeps them for the gallery.

## Which header carries the caller's address

**Tested on `circles-dev` on 3 October 2026 (SUS-107).** Every per-address rate
limit keys on `cf-connecting-ip` and on nothing else
(`supabase/functions/_shared/rate.ts`, `callerAddress`).

A throwaway Edge Function, deployed to `circles-dev` only and removed
afterwards, returned the four candidate headers exactly as a function receives
them. Real client addresses are personal data and this repository is public, so
they are redacted below; the made-up values are from the documentation range
(RFC 5737) and are verbatim.

| Request | `cf-connecting-ip` | `x-real-ip` | `x-forwarded-for` | `forwarded` |
|---|---|---|---|---|
| plain | the caller's public address (redacted) | not sent | the caller's address twice, then a platform address (redacted) | not sent |
| `cf-connecting-ip: 203.0.113.7` forged | **refused before the function ran: HTTP 403, Cloudflare error 1000** | n/a | n/a | n/a |
| `x-real-ip: 203.0.113.7` forged | the caller's public address (redacted) | not sent: dropped | as plain | not sent |
| `x-forwarded-for: 203.0.113.7` forged | the caller's public address (redacted) | not sent | as plain: the forged entry is gone | not sent |
| `forwarded: for=203.0.113.7` forged | the caller's public address (redacted) | not sent | as plain | `for=203.0.113.7`, **passed through as written** |
| `x-real-ip`, `x-forwarded-for` and `forwarded` all forged | the caller's public address (redacted) | not sent | as plain | as written |

What that settles:

- **`cf-connecting-ip` is the caller's address and cannot be chosen by the
  caller.** A request that brings one of its own never reaches a function.
- `x-real-ip` is never delivered, and `x-forwarded-for` is rewritten by the
  platform, so neither is a second source worth reading.
- **`forwarded` is attacker-controlled** and passes through untouched. Nothing
  may key on it.
- The per-address limits therefore do not give a caller a bucket of their
  choosing, and they do not put every caller in one bucket either.

**Second network: not measured.** A second reading from a different network was
attempted on 5 October 2026 and came back empty (the request did not complete on
that network), and the founder chose on 6 October 2026 to go ahead on the first
reading. What it would have confirmed, that two callers on different networks get
different buckets, follows from the table above: the key is the caller's own
public address, which Cloudflare sets and the caller cannot change. The unit tests
in `_shared/kit.test.ts` cover the code's half (two addresses, two keys). The
temporary function `tmp-sus107-ip-echo` was deleted from `circles-dev` on
6 October 2026, and `supabase functions list` no longer shows it.

The local stack has no Cloudflare in front, so `cf-connecting-ip` is absent
there and every local caller shares the bucket `unknown`. A hosted request
without it does the same, which fails closed. If a limit is ever hit by a real
group on a hosted project, check this first. To repeat the reading, deploy a
function that echoes those four headers to `dev` (never `prod`), call it, and
remove it again.

## Expected security-advisor warnings

`get_advisors(type: "security")` on a hosted project reports the findings below.
They are **correct and expected**. Check any new one against this list before
treating it as a finding. Read from the Management API on both `circles-dev` and
`circles-prod` on 19 October 2026 (`GET /v1/projects/<ref>/advisors/security`,
read-only token); the two returned the same 89 findings.

| Finding (level, count) | Why it is fine |
|---|---|
| `security_definer_view` (ERROR, 3): `plan_interest_counts`, `response_summaries`, `circle_roster` | Deliberate. A view reads the base tables as its owner so a member can see an aggregate without seeing the rows under it, and each one filters on the caller inside its own `WHERE`: `circle_roster` on `auth.uid()` being an active member of the same circle, the other two on `auth_is_member(circle)`. `plan_interest_counts` joins `private.plan_interest` by design and shows counts only, never who (ADR 0060). A fourth definer view is a finding. |
| `rls_enabled_no_policy` (INFO, 20): `analytics.events`, five tables in `jobs`, `planning.transitions`, twelve in `private`, `public.circle_invites` | Deliberate. These tables have row-level security on and no policy, plus `revoke all … from anon, authenticated`, so no client can read or write them; only definer functions and the service role reach them. `supabase/tests/database/490_catalogue.sql` fails if a table in `private`, `jobs`, `analytics` or `planning` is readable or writable by `anon` or `authenticated`; `public.circle_invites` has its grants revoked in migration `0002`. |
| `function_search_path_mutable` (WARN, 4): `public.canonical_display_name`, `public.member_cap`, `public.soft_quorum`, `planning.allowed_keys` | Fixed by SUS-192 (migration 0069), which pins each to `search_path = ''`. They are plain immutable helpers that read no table, so there was nothing to hijack, and they no longer appear once 0069 is deployed to the project. **After that deploy, any `function_search_path_mutable` is a real finding.** |
| `anon_security_definer_function_executable` (WARN, 6): `auth_is_member`, `auth_is_owner`, `auth_is_permanent`, `invite_preview`, `preview_for_code`, `rls_auto_enable` | The first three are called by the RLS policies, so they carry `revoke all … from public` and an explicit grant to exactly `anon` and `authenticated` (§14); each answers from `auth.uid()` and says false for nobody signed in. `invite_preview` and `preview_for_code` are what a link shows before any sign-in, and return only the preview a link already carries. `rls_auto_enable` is not ours: a Supabase platform event-trigger function that auto-enables RLS on new public tables. It reads `pg_event_trigger_ddl_commands()`, so a direct call outside a DDL event does nothing. |
| `authenticated_security_definer_function_executable` (WARN, 37): the same six, plus 31 product functions (`create_circle`, `create_plan`, `revise_plan`, `confirm_meetup`, `remove_member`, `founder_summary` and the rest) | Deliberate. Authorisation is in the database (§7.4): each is a definer function called, by an Edge Function or directly over RPC, with the caller's JWT, and each decides from `auth.uid()` (membership, ownership, or for the founder functions the allowlist). `490_catalogue.sql` fails if a definer function does not pin its `search_path` or is executable by `public`. A function that appears here and is not a product function is a finding. |
| `auth_allow_anonymous_sign_ins` (WARN, 18): sixteen tables in `public`, plus `cron.job` and `cron.job_run_details` | Anonymous sign-in is the product: a guest answers with no account. The policies on these tables apply to the `authenticated` role, which anonymous users hold, and gate on `auth_is_member`, `auth_is_permanent` or `auth.uid()` wherever a table needs more than "signed in". The two `cron` tables are pg_cron's own, created by the extension. |
| `auth_leaked_password_protection` (WARN, 1) | There are no passwords. Sign-in is a six-digit code or an OAuth provider (§10). |

Also true, and not in the table because the advisor does not name it: `pg_net`'s
`net.http_get` and `net.http_post` are executable by `anon` and `authenticated`.
Supabase grants them as `supabase_admin`, who owns the `net` schema; the role
migrations run as can neither revoke them nor own them, so SUS-125 could not
close it. The schema is not exposed over PostgREST and nothing of ours wraps it
(`supabase/tests/database/480_small_hardening.sql` fails if a function other than
the scheduler's mentions `net.http`), so there is no path. A new definer function
that calls `net.*` is the thing to refuse in review.

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

## If the host ever has to change

Avoid it: once a link has reached anybody but the founder, the host is
permanent ([ADR 0044](../decisions/0044-production-is-wenna-app-and-the-host-is-permanent-once-a-link-leaves.md)).
If it has to happen anyway, in order:

1. **A redirect host for the old domain, outside EAS** (EAS serves one custom
   domain per project). It preserves path, query and fragment, and it keeps
   serving `/brand/*.png`, or redirects them, for every email already sent.
   Keep it running for as long as old links matter.
2. `brand.ts`: `domain`, `sender`, `supportEmail`.
3. DNS on the new domain: the records above.
4. Resend: add and verify the new sending domain. The old one keeps working
   until it is deleted, so verify the new one before deleting.
5. EAS Hosting: attach the new domain.
6. Turnstile: the widget is bound to a hostname, so add the new one. The
   `expo.app` host stays on the widget too, because `dev` is always reached
   that way.
7. Supabase Auth on `prod`: site URL and redirect URLs.
8. **Google OAuth: the web client must be re-created.** Authorised origins can
   be edited, but a client that has been live on the old origin carries consent
   grants tied to it, so re-create rather than edit.
9. Apple: update the Services ID's return URLs and the associated domain.
10. `EXPO_PUBLIC_APP_ORIGIN` on the **`production` environment only**. The
    repository-scope copy is `dev`'s and stays on the `expo.app` host.
11. `pnpm check:env <new domain>`.
