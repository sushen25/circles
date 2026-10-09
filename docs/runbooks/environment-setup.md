# Environment setup checklist

One-time. Every step here needs an account, a card or a DNS panel, so it is the
founder's to do — the agent side (config, guards, docs, CI wiring) is already
committed and waiting for these values.

Work top to bottom: later steps need earlier ones. Tick as you go. Nothing here
is reversible-by-accident, but **step 3 costs money** and **step 2 spends about
US$20/year**.

**One exception to top-to-bottom: do step 7 (Turnstile) before step 2 (the
domain).** Attaching the domain needs a production deployment, and a production
deploy refuses to run without the Turnstile site key, so the numbered order is
a deadlock. The numbers are left alone because they are referred to from the
other runbook, from the workflows' comments and from several Linear tickets;
renaming them to fix one edge would break more than it mends. Turnstile can go
first safely — a widget lists hostnames without resolving them, so it does not
need the domain to exist.

Reference for anything that needs explaining: [`environments.md`](./environments.md).

---

## 1. Supabase projects — free, ~10 min

- [x] Create project **`circles-dev`**, region closest to you, Free plan.
      → `pcfekupwqrdfryeaqggx`, `ap-south-1`
- [x] Create project **`circles-prod`**, same region, Free plan.
      → `bhunoaqswteamabbyckp`, `ap-southeast-1`
      **The two are in different regions, and neither is Sydney.** See the note
      in [`environments.md`](./environments.md) — worth settling now, while both
      are empty, because a region is fixed at creation.
- [x] On **both**: Authentication → Providers → enable **Anonymous sign-ins**.
      Confirmed: `/auth/v1/settings` reports `anonymous_users: true` on both, and
      a real anonymous sign-up against `dev` returned a session with
      `is_anonymous: true`.
- [x] On **both**: Authentication → enable **Email OTP** (magic-code, not password).
      Confirmed the email provider is on and `mailer_autoconfirm` is `false`, so a
      code is actually sent. Whether the template sends a **code** rather than a
      magic link cannot be read from outside — S1-14 has to check the template.
- [x] On **both**: Authentication → Rate Limits → anonymous sign-ins **60/hour per IP**.
      The default is far lower and breaks households behind one address (§14).
      Confirmed by the founder from the dashboard, not by a check — no API
      exposes this value, so it is the one item in step 1 taken on trust.
- [ ] On **`circles-prod`**: Authentication → URL Configuration → **Site URL**
      `https://wenna.app`, and **Redirect URLs** `https://wenna.app/**` with
      nothing else on it (SUS-99). Sign-in is a six-digit code, so nothing
      redirects through these today, but the site URL is what Supabase's own
      emails link to, and a stale one points them at a host that no longer
      serves the app.
- [x] Copy each **project ref** (the subdomain in the project URL) into the table
      in [`environments.md`](./environments.md). Refs are not secret.
- [x] Account → Access Tokens → create one named `github-actions`.
      Confirmed: the `SUPABASE_ACCESS_TOKEN` repository secret exists (8 September
      2026) and the `deploy-dev` workflow authenticates with it.

**Hand back:** the two project refs, the access token, and each project's
**Project URL** and **anon key** (Settings → API).

> Free projects pause after 7 days of no API requests. If `dev` looks broken
> after a quiet week, un-pause it before debugging anything else.

> **`circles-prod` was paused, and was resumed on 15 September 2026** to be
> deployed to. It is healthy now. The episode is left here because it will
> happen again after any quiet week and it does not look like what it is: a
> paused project answers no API call, so configuring a provider or setting a
> secret on it fails in a way that reads like a credentials problem. Check
> `list_projects` for `INACTIVE` before debugging anything else.

## 2. Domain — `wenna.app`

Production's host is the apex **`wenna.app`**, bought 29 September 2026 and
delegated to Route 53 (its own hosted zone; `dig NS wenna.app` answers with four
`awsdns` servers). Founder decision, SUS-99.

History, in one line: prod ran on `meet.sushensatturu.com`, a holding domain on the founder's personal apex, from 15 September 2026 to the cutover; it was retired without a redirect, since no invite had left the founder.

`.app` is on the HSTS preload list, so plain HTTP never works on it, on any
name under it. Every check is HTTPS.

Why the domain comes before Turnstile's hostname list and the OAuth clients:
each of those stores a hostname as text, and a Google web client has to be
**re-created** rather than edited when its origin changes, because a client that
has been live carries consent grants tied to it. So the order is: **Turnstile,
then the domain, then Apple and Google** (Apple and Google are deferred: SUS-77).
Turnstile comes before the domain because attaching the domain needs a
production deployment, and a production deploy refuses to run without
`EXPO_PUBLIC_TURNSTILE_SITE_KEY` (`REQUIRE_TURNSTILE=true`). A widget lists
hostnames without resolving them, so it has nothing to wait for.

The one hard boundary: **§5.2 forbids shipping links on `*.expo.app`.** Before
any invite link reaches a person who is not the founder, the custom domain has
to exist, because a link already in a group chat cannot be recalled. And once
one has, **`brand.domain` is permanent** (see the header of
[`brand.ts`](../../packages/config/src/brand.ts)).

**EAS Hosting allows exactly one custom domain per project**, assigned to the
production deployment, so:

- [ ] `wenna.app` — the `prod` app host, attached as an **apex**. EAS Hosting
      supports apex domains with an **A record** rather than a CNAME, which
      Route 53 cannot put at an apex for a non-AWS target. Attaching it
      replaces the previous custom domain in the project's one slot.
- [ ] `dev` — **no custom domain.** It stays on
      `sushen25s-team-circles--dev.expo.app`, which costs nothing, because §5.2
      binds links that reach a real person and `dev` never sends an invite.
- [ ] `mail.wenna.app` — the sending domain. **Production only**; `dev` does
      not send. Done with Resend in step 5, in the same DNS session.
- [ ] `hello@wenna.app` — the support address, the `Reply-To` of every product
      email. It has to reach a mailbox somebody reads: see step 5.

The records come from EAS and from Resend, and guessing them means deleting
them later. Attaching the domain is **dashboard-only** — `eas-cli` has no
hosting or domain command, so there is nothing to automate here.

### Attaching `wenna.app` in the EAS dashboard

<https://expo.dev/accounts/sushen25s-team/projects/circles/hosting> → settings →
custom domain. It asks for three records, and the order matters — add each one
and refresh before adding the next, or the check runs against a record that is
not visible yet:

| # | Name (in the `wenna.app` zone) | Type | Purpose |
|---|---|---|---|
| 1 | `_cf-custom-hostname` | TXT | proves you own the domain |
| 2 | `_acme-challenge` | CNAME | proves it to the certificate authority, so a certificate can be issued |
| 3 | *(blank: the apex)* | A | routes requests; EAS's documentation gives `172.66.0.241`, but take the value from the dashboard |

The first two carry per-domain tokens that the dashboard generates. Confirm all
three through both `1.1.1.1` and `8.8.8.8` before waiting on the certificate.

> **The domain cannot be attached until production is deployed.** The dashboard
> refuses to open the custom-domain form at all, with *"Create a production
> deployment first. You must promote a deployment to production before you can
> set up a custom domain."* Verified 15 September 2026. Production has been
> deployed since then, so this no longer blocks anything; it is kept because it
> explains the Turnstile-first order above.

Then check the invite route on the new host. `https://wenna.app/join?x=1#notarealsecret`
renders the join flow, not the not-found screen. The client takes the fragment
out of the address bar as it loads (ADR 0023), and no request in the network
panel carries `notarealsecret`. Then the real thing: once sign-in works
(SUS-84), make a test circle on prod, copy its invite link, and join it from a
second browser.

### How to add a record in Route 53

`wenna.app` has **its own hosted zone**, delegated from the registrar. Do not
create another zone for a subdomain such as `mail.wenna.app`: a zone per
subdomain costs US$0.50/month each and needs NS delegation records glued back
to the parent; it is the standard way to lose an afternoon here.

1. Route 53 → **Hosted zones** → `wenna.app` → **Create record**.
2. **Record name**: type the part *before* the zone only — `mail`, not
   `mail.wenna.app`, and **blank** for the apex. The console appends the rest
   and shows you the full name underneath. Getting this wrong gives you
   `mail.wenna.app.wenna.app`, which resolves for nobody.
3. **Record type**: as the vendor says — `A` for the apex, `CNAME` for the
   certificate challenge and Resend's delegations, `TXT` for SPF/DKIM/DMARC,
   `MX` for receiving.
4. **Value**: paste exactly what the vendor gives.
5. **TTL 300** while setting up. A mistake then expires in five minutes instead
   of a day. Raise it once `pnpm check:env` is green.

Two Route 53 specifics that bite:

- **TXT values must be wrapped in double quotes.** `"v=spf1 include:amazonses.com ~all"`,
  not the bare string. Route 53 rejects or mangles unquoted values.
- **A TXT string cannot exceed 255 characters.** A 2048-bit DKIM key is longer,
  and must be split into several quoted strings on one line —
  `"p=MIIBIj...first255" "...remainder"` — which Route 53 then joins. Resend's
  console usually shows it pre-split; if it does not, split it yourself.

CLI equivalent, if you prefer:

```bash
aws route53 change-resource-record-sets \
  --hosted-zone-id "$(aws route53 list-hosted-zones-by-name \
      --dns-name wenna.app --query 'HostedZones[0].Id' --output text)" \
  --change-batch '{"Changes":[{"Action":"UPSERT","ResourceRecordSet":{
      "Name":"wenna.app","Type":"A","TTL":300,
      "ResourceRecords":[{"Value":"<address from EAS>"}]}}]}'
```

The CLI wants the **full** name, unlike the console — the opposite convention,
which is exactly why this is written down.

## 3. EAS Hosting — US$19/month

- [x] Upgrade the **`sushen25s-team`** account to **Starter**:
      <https://expo.dev/accounts/sushen25s-team/settings/billing>
      Confirmed by the founder, 15 September 2026, on the **team** account —
      the one that owns the project (`eas project:info` reports
      `@sushen25s-team/circles`) and that `app.config.ts` pins as `easOwner`.
      This step used to name `@sushen25` and corroborate it with "the `dev`
      alias serves", which proves nothing: free EAS Hosting serves `*.expo.app`
      too. The paid plan only shows itself on the features it gates, and the
      first of those is the custom domain.
- [x] Create an **access token** (Account → Access Tokens) named `github-actions`.
      Confirmed: the `EXPO_TOKEN` repository secret exists (8 September 2026),
      which is also the switch that turns the deploy workflows on.

**Hand back:** the token.

> This is the only recurring charge right now. Cancel it and previews and the
> deployed web app stop; nothing else breaks.

## 4. Tell CI about all of that

In the repository settings, **Secrets and variables → Actions**:

- [x] Secrets → `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DEV_PROJECT_REF`,
      `SUPABASE_PROD_PROJECT_REF`, `EXPO_TOKEN`. All four confirmed present.
- [ ] **Split them (SUS-104).** Those four are account-wide tokens at
      repository scope, readable by every branch's `preview` run. Production's
      move to the `production` environment under their own names
      (`SUPABASE_PROD_ACCESS_TOKEN`, `SUPABASE_PROD_PROJECT_REF`,
      `EXPO_PROD_TOKEN`), the repository keeps dev-only tokens, and the
      September ones are revoked. The steps are in
      [`ci.md`](./ci.md), "Rotating them". `deploy-prod` fails
      until the three production names exist.
- [x] **Variables** (repository scope — these are the `dev` values, and previews
      read them):
      `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`,
      `EXPO_PUBLIC_APP_ORIGIN`. All three confirmed present.
      `APP_ORIGIN` is `https://sushen25s-team-circles--dev.expo.app`, and
      **never changes.** It is not a placeholder waiting for a domain: step 2
      settled that `dev` keeps the `expo.app` host permanently, because EAS
      Hosting allows one custom domain per project and production takes it.
      Repository scope is read by `deploy-dev` and by every per-PR preview, so
      pointing it at `https://wenna.app` would
      aim dev deploys, dev updates and every preview at the production origin —
      which is why this says so here rather than leaving it to be inferred.
      Production overrides it from the `production` environment; that is the
      only place the live origin belongs.
- [x] `EXPO_PUBLIC_TURNSTILE_SITE_KEY` (repository scope). Set 15 September
      2026 to the **dummy always-passes** site key `1x00000000000000000000BB`,
      not the real one — deliberately. `preview.yml` and `deploy-dev.yml` both
      read the repository-scope variable, and a per-PR preview is served from
      `sushen25s-team-circles--pr-N.expo.app`, a *sibling* of the `dev` host
      rather than a subdomain, so the real widget's hostname list cannot cover
      it. The alternative was widening the widget to `expo.app`, which would
      cover every Expo app in the world. Dummy keys work on any hostname, so
      dev and previews exercise the whole path — widget, token, verification —
      and always pass. The real key lives on the `production` environment,
      which overrides this one.
- [x] Environments → `production` → **Variables**. Environment created and
      three of four set, 15 September 2026:
      `EXPO_PUBLIC_TURNSTILE_SITE_KEY` (the real key),
      `EXPO_PUBLIC_APP_ORIGIN`, and
      `EXPO_PUBLIC_SUPABASE_URL` = `https://bhunoaqswteamabbyckp.supabase.co`.
- [ ] `EXPO_PUBLIC_APP_ORIGIN` on `production` → **`https://wenna.app`**
      (SUS-99). Only the `production` environment's copy changes; the
      repository-scope one above stays on the `expo.app` host.
- [x] `EXPO_PUBLIC_SUPABASE_ANON_KEY` on `production` — set 15 September 2026 to
      the **publishable** key (`sb_publishable_…`), matching the form `dev`
      uses rather than the legacy `anon` JWT. Public, like the `dev` one in the
      repository variables. A production deploy fails the client-config check
      without it, which is what it was doing.
- [x] Environments → `production` → add yourself as a **required reviewer**, so a
      production deploy pauses for a human. Confirmed 28 September 2026: the
      environment carries a `required_reviewers` rule naming `sushen25` and a
      branch policy allowing `main` only.

> Variables, not secrets, on purpose: they are compiled into the client bundle
> and readable by anyone. Calling them secret teaches the word to mean nothing.

## 5. DNS and email authentication

- [ ] Resend → add domain **`mail.wenna.app`**. Production only — `dev` does
      not send, and a second sending domain is a second set of records to keep
      warm for no benefit. The region is fixed at creation; the previous
      sending domain used `ap-northeast-1` (Tokyo), which is fine for email,
      since it is asynchronous.
- [ ] Add Resend's records in the `wenna.app` zone, and confirm them through
      both `1.1.1.1` and `8.8.8.8`. **Resend delegates by CNAME rather than
      handing you an SPF TXT and an MX directly.** Expect this shape, but take
      the values from Resend:

      | Name (in the zone) | Type | Value |
      | --- | --- | --- |
      | `resend._domainkey.mail` | TXT | `p=MIGf…` (Resend's key) |
      | `send.mail` | CNAME | `send.forge.rmta.net` |
      | `rsend.mail` | CNAME | `rsend-<region>.forge.rmta.net` |

      `check:env` follows the CNAME: `send.mail.wenna.app` answers a TXT query
      with `v=spf1 … ~all` and an MX query with `feedback.forge.rmta.net`, both
      from the target. DKIM sits at `resend._domainkey.mail.wenna.app`, the
      name that has to align with the header `From`.

      Three traps. **`rsend` is not a typo of `send`** — it is a separate
      record, and both are required. **A CNAME cannot coexist with any other
      record at the same name**, so nothing else may ever be added at
      `send.mail` or `rsend.mail`. And the **bounce MX is the one people
      skip** — it arrives through the `send.` CNAME, so it is easy to believe
      it is missing; without it Resend cannot tell a hard bounce from silence
      and the suppression list never fills.

      A DKIM value with no `v=DKIM1; k=rsa;` prefix, just a bare `p=`, is valid:
      RFC 6376 makes `v=` optional.
- [ ] Add DMARC on `_dmarc.mail`: `"v=DMARC1; p=none; rua=mailto:<address from
      the reporting service>"`. `p=none` first — it reports without
      rejecting. Raise to `p=quarantine` after a week of clean reports.

      **The `rua=` has to be a reporting service, not a personal address.**
      RFC 7489 §7.1: when the reporting address sits at a different domain
      from the DMARC record, the reporting party must first find a `v=DMARC1`
      TXT at `mail.wenna.app._report._dmarc.<rua-domain>`. `gmail.com`
      publishes none, and Google, Microsoft and Yahoo all enforce the check, so
      a Gmail `rua` publishes an address in public DNS and collects almost
      nothing. Postmark DMARC Digests and Dmarcian are both free and both
      publish the authorisation. Leaving `rua=` out is the other option, and
      the one to take if you would not read the reports.
- [ ] **Receiving for `hello@wenna.app`**, which is `brand.supportEmail` and
      the `Reply-To` of every product email. Without it a reply from a real
      person vanishes, which is worse than having no support address at all.
      Route 53 cannot forward mail itself. Use a forwarding service (ImprovMX's
      free plan, for example) or the registrar's forwarding if it offers one:
      either gives you two **MX** records and usually an SPF TXT for the
      **apex**. They sit beside the apex `A` record without conflict, and they
      are separate from the sending domain's records, which live under `mail.`.
      Forward to the founder's inbox. Check it by sending a message to
      `hello@wenna.app` from another account.
- [ ] Wait for Resend to show the domain **verified** (minutes to hours). Once
      the records are live, this is Resend's own check catching up.
- [ ] Verify from the outside: **seven of seven**.

```bash
pnpm check:env wenna.app
pnpm check:env sushen25s-team-circles--dev.expo.app --no-email
```

There are **seven** checks, not six: HTTPS, HSTS and `Referrer-Policy` on the
host, then SPF, DKIM, bounce MX and DMARC on the sending domain. The two
HTTP-header checks only run if the first one connects, so a host that does not
resolve reports one failure rather than three. **Five checks reported instead
of seven means the host is gone, not that two checks passed.**

The second command names the `expo.app` host because `dev` has no custom domain
(step 2).

`Referrer-Policy: no-referrer` matters more than it looks: invite secrets ride
in the URL fragment, and a leaked referrer is how they escape (§14).

## 6. Resend

**Product email is deferred**, not all email. The Resend sending domain is
verified and its API key is on `circles-prod`. S1-19 brought the templates, the
sending code and the webhook endpoint; nothing sends until S1-20's dispatcher
calls them. Testing happens locally against Mailpit — see
[`environments.md`](./environments.md).

**Supabase Auth already sends, and it is not Resend.** Sign-in codes come from
the hosted project itself, and with email OTP enabled and `disable_signup`
false anyone holding the publishable key can make `circles-prod` send a real
stock magic-link email — a template the product does not implement — against a
small shared Free-plan quota. See `environments.md`; the lever is
`disable_signup`.

- [x] API Keys → create one, **sending permission only**, named `circles-prod`.
      Set on `circles-prod` as `RESEND_API_KEY`. Not on `circles-dev`, and that
      is correct: `dev` does not send, and email is tested against Mailpit.
- [ ] **Resume `circles-prod` first** if it is paused — a secret set on a
      paused project fails in a way that reads like a credentials problem.
- [ ] Webhooks → add an endpoint at
      `https://bhunoaqswteamabbyckp.supabase.co/functions/v1/email-provider-webhook`,
      for `email.sent`, `email.delivered`, `email.delivery_delayed`,
      `email.bounced`, `email.complained` and `email.failed`. Opens and clicks
      are not recorded and need not be sent; the function acknowledges and
      drops them if they are. Until the function is deployed the endpoint
      fails, and Resend retries, so creating it first is harmless.
- [ ] Copy the **webhook signing secret** straight into the project, never into
      a file or a chat:
      `make secret ENV=prod K=RESEND_WEBHOOK_SECRET V=…` (step 9 says why
      `make`, not `supabase secrets set` from the repository).
      Without it the function refuses every event — it fails closed — and
      bounces go unrecorded.
- [ ] Check it: Resend → Webhooks → the endpoint → send a test `email.delivered`
      event. The function answers 200 and stores it in
      `private.email_delivery_events` with no `job_id`, because a test event
      names no message this product sent. A 401 means the secret is missing or
      is not the one on the endpoint.

**Hand back:** nothing — both secrets live only in the project.

## 7. Cloudflare Turnstile — free

**This is now the first vendor step, ahead of the domain** (15 September 2026).
`deploy-prod.yml` sets `REQUIRE_TURNSTILE: 'true'`, so a production deploy fails
without the site key — and a production deploy is what unlocks attaching the
custom domain. Turnstile therefore cannot come after the domain; it comes first.
Due before S1-14.

- [x] Turnstile → add a widget, **Invisible** mode. Done 15 September 2026, with
      the production host of the day, `sushen25s-team-circles--dev.expo.app`
      and `localhost`.
- [ ] The widget's hostnames → add **`wenna.app`** and remove the previous
      production host (SUS-99). Add before the cutover deploy, remove after:
      a page served from a host the widget does not list fails every web join,
      and the failure looks like a broken join rather than a configuration
      gap. `dev` has no custom domain (step 2), so the `expo.app` host stays.

      The name does not have to resolve to be listed. Turnstile matches the
      hostname a page is served from against this list; it does no DNS lookup
      when you save the widget. That is what lets this step run before the
      domain exists.

      Per-PR preview aliases (`sushen25s-team-circles--pr-N.expo.app`) are
      siblings of the `dev` host rather than subdomains, so they are not
      covered. They should use the dummy keys below rather than widening this
      list to `expo.app`, which would cover every Expo app in the world.

**Hand back:** the **site key** (public → GitHub variables as
`EXPO_PUBLIC_TURNSTILE_SITE_KEY`) and the **secret key** (→ step 9, where it
must be stored as `TURNSTILE_SECRET_KEY` and under no other name).

**This does not block writing the Turnstile code.** Cloudflare publishes dummy
keys that behave deterministically, so the widget, the token round-trip and the
failure path can all be built and tested before the real widget exists. Use the
**invisible** pair, because that is the mode the product uses — the visible
`…AA` sitekey renders a widget the app never asks for:

| | Site key | Secret key |
|---|---|---|
| always passes | `1x00000000000000000000BB` | `1x0000000000000000000000000000000AA` |
| always fails | `2x00000000000000000000BB` | `2x0000000000000000000000000000000AA` |
| token already spent | — | `3x0000000000000000000000000000000AA` |

A test secret key accepts **only** the dummy token and rejects real ones, and a
real secret rejects the dummy — so a pair that has been half-swapped fails
closed rather than passing everything, which is the direction you want. None of
these are secret; they are in Cloudflare's public documentation. They are still
not a substitute for the real widget: they prove the wiring, not that anyone is
being turned away.

**Production refuses all five of them.** The split above works because two
scopes hold different keys, and the thing that can quietly undo it is the
production scope ending up with a dummy — an environment variable deleted, a
scope confused, a value copied from this table. `check-client-env.mjs` tested
`length > 0`, which every dummy key satisfies, so the guard that exists to keep
the join flow closed would have passed the one configuration that opens it. It
now names the key and refuses it when `REQUIRE_TURNSTILE=true`. Dev and
previews are untouched: they never set that variable, and the dummy key there
is deliberate.

## 8. Apple and Google sign-in

**Deferred** (founder decision, 1 October 2026): the founder cohort signs in
with an email code only, and this step waits on SUS-77. Verified off on both
projects (`/auth/v1/settings` reports `apple: false, google: false`).

**The name has to be settled, not attached.** Founder decision, 15 September
2026: create the web client once, against the final origin, rather than against
the `expo.app` host and again later — the client that would be re-created is
the one carrying real consent grants. But an OAuth client stores its origin as
text and checks no DNS when you save it, so "settled" is the whole
requirement, and `wenna.app` is settled.

S1-14 is not idle while this happens — the email-code path, anonymous sessions,
session persistence, identity linking and the guards all work against the local
stack, and the Turnstile path has the dummy keys in step 7. Apple and Google are
the only parts that need this step.

- [ ] Apple Developer → **Services ID** for the web sign-in; return URL is
      `https://bhunoaqswteamabbyckp.supabase.co/auth/v1/callback` for prod and
      `https://pcfekupwqrdfryeaqggx.supabase.co/auth/v1/callback` for dev.
- [ ] Apple → **Sign in with Apple key**; download the `.p8` **once** — it
      cannot be downloaded twice.
- [ ] Google Cloud → OAuth consent screen, then **three** clients: web (origins
      `https://wenna.app` and
      `https://sushen25s-team-circles--dev.expo.app`), iOS (bundle
      `app.circles.production`), Android (package + SHA-1 from EAS
      credentials).
      **The `expo.app` host for `dev`** — step 2 decided `dev` has no custom
      domain, and an origin that does not exist authorises nothing while the
      origin that does is rejected as a mismatch.
- [ ] Supabase → Authentication → Providers → configure Apple and Google on
      **both** projects.

> The Google **web** client is bound to the origin. If the production host ever
> changes, re-create it rather than editing it.

## 9. Secrets onto the projects

Never into the repository, never into `.env`. **The two projects take different
sets**, so there is deliberately no single command for both — one would be wrong
in whichever direction it was written.

**`TURNSTILE_SECRET_KEY` is the trap.** Step 7 puts the dummy *site* key at
repository scope, so `dev` and every per-PR preview send a dummy token — and a
real secret rejects a dummy token, the same property that makes a half-swapped
pair fail closed. Copy the real secret to `dev` and every web join there fails
verification, in the environment whose whole job is to catch that before
production does.

**`RESEND_*` is the other one**, in the opposite direction: `dev` must not have
a sending key at all, because `dev` does not send and email is tested against
Mailpit.

**Set secrets with `make secret`, never with `supabase secrets set` run from
inside the repository.** The CLI always sends `[edge_runtime.secrets]` from the
`config.toml` it finds by walking up from where it runs, alongside whatever you
asked for. Run from this checkout, it also sets the local stack's
`EMAIL_CAPTURE_URL` (which wins over `RESEND_API_KEY`, so every product email
goes to a mail catcher that does not exist on a hosted project) and
`CRON_SECRET = "local"` (an internal bearer anybody can read in this
repository). That happened to `circles-prod` on 23 September 2026. `make secret`
and `make unsecret` run the CLI from an empty directory, so only the named
secret is sent. Check afterwards with `make secrets ENV=prod`: **there must be
no `EMAIL_CAPTURE_URL`**, and `CRON_SECRET`'s digest must not be
`25bf8e1a…ddcf6`, which is the SHA-256 of `local`.

The Apple private key is a file, so it goes as its contents:

```bash
make secret ENV=prod K=APPLE_PRIVATE_KEY V="$(cat AuthKey_XXXX.p8)"
```

**The two projects do not take the same set**, so one command for both is wrong
in whichever direction you write it — it either gives `dev` a sending key it
must not have, or leaves out `CRON_SECRET` and the internal functions refuse
every call. Per project, one secret per line, matching the table below:

```bash
# circles-prod — the real Turnstile secret, and the only project that sends
make secret ENV=prod K=CRON_SECRET V=...
make secret ENV=prod K=TURNSTILE_SECRET_KEY V=...
make secret ENV=prod K=RESEND_API_KEY V=...
make secret ENV=prod K=RESEND_WEBHOOK_SECRET V=...
make secret ENV=prod K=HEALTH_REPORT_TO V=...
```

```bash
# circles-dev — the dummy Turnstile secret, and no Resend at all
make secret ENV=dev K=CRON_SECRET V=...
make secret ENV=dev K=TURNSTILE_SECRET_KEY V=1x0000000000000000000000000000000AA
```

`APPLE_*` and `GOOGLE_*` go on both, and on neither yet — SUS-77.

**Where this stands, 15 September 2026.** Apple, Google and the Resend webhook
secret are unset — S1-14b and S1-19 respectively — which is why this step cannot
be ticked whole. Everything else is in place:

| Secret | `circles-dev` | `circles-prod` |
|---|---|---|
| `CRON_SECRET` | set | set |
| `TURNSTILE_SECRET_KEY` | the dummy, **verified** | the real one |
| `RESEND_API_KEY` | — by design, `dev` does not send | set |
| `RESEND_WEBHOOK_SECRET` | — | S1-19, the endpoint does not exist yet |
| `APPLE_*`, `GOOGLE_*` | — | — S1-14b |

`CRON_SECRET` is the odd one out: **no vendor issues it.** It is a value you
invent, and its only job is that the database and the Edge Function agree on
it — `jobs.invoke_process_scheduled_jobs()` sends it as a bearer, and
`_shared/internal.ts` compares what arrives. Generate it with a password
manager rather than by hand, because it cannot be read back afterwards and
the Vault secret `circles_cron_secret` needs the same string
([`environments.md`](./environments.md), "Vault secrets the cron job reads").

> **You can prove a secret is the value you meant, without reading it.** The
> `value` field `supabase secrets list` returns is a plain SHA-256 of the
> secret — verified against a secret whose value is known, `SUPABASE_URL`.
> So for a value that is *already public*, hashing the candidate and comparing
> settles it. That is how `circles-dev`'s `TURNSTILE_SECRET_KEY` was confirmed
> to be Cloudflare's always-passes dummy rather than the real secret — the
> exact confusion this runbook used to invite, and the one thing that would
> have failed every web join on `dev`. It works only because the candidate is
> public knowledge; it says nothing about a secret you do not already have.

- [x] Set on `circles-dev` (`pcfekupwqrdfryeaqggx`). Apple and Google pending.
- [x] Set on `circles-prod` (`bhunoaqswteamabbyckp`). Apple and Google pending.
- [x] `supabase secrets list --project-ref <ref>` on both — it prints names and
      digests, never values. Names confirmed against
      [`environments.md`](./environments.md).
- [ ] Delete the `.p8` from Downloads. Nothing to delete yet — S1-14b.

## 10. Confirm the whole thing

- [x] `pnpm check:env sushen25s-team-circles--dev.expo.app --no-email` — HTTPS
      and HSTS pass. `Referrer-Policy` failed: EAS Hosting sets none, and
      `/j/<code>` and `/p/<code>` carry codes in the path.
      **Fixed in the app rather than in the host** — the `expo-router` plugin in
      `apps/app/app.config.ts` now sets it on every HTML and API-route response,
      which is the only place that can set it, since EAS Hosting has no header
      configuration of its own. Verified against an exported build served by
      `expo serve`: `/` and `/j/<code>` both answer `referrer-policy: no-referrer`.
      The deployed app keeps failing this check until the next `deploy-dev` run
      ships the change; re-run the check then.
- [x] Push to `main`; the `deploy-dev` run summary shows Supabase and Expo both
      `true` rather than "waiting on S0-11".
- [x] `https://sushen25s-team-circles--dev.expo.app/` serves the app, and
      `https://pcfekupwqrdfryeaqggx.supabase.co/functions/v1/hello` returns
      `{"domain":"@circles/domain","contracts":"@circles/contracts","validated":true}`
      — which is ADR 0007's open question answered: the domain package really
      does load and run inside Deno.
- [x] Open a throwaway PR and confirm the preview URL is posted on it.
- [x] gitleaks green on that PR — nothing from this checklist reached the repo.

---

## What is still not done after this

- **Store accounts** (Apple Developer US$99/yr, Play US$25 once) — Slice 3, S3-01.
- **Supabase Pro** on `prod` — Slice 4, before the external cohort.
