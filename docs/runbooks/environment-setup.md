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
- [x] Copy each **project ref** (the subdomain in the project URL) into the table
      in [`environments.md`](./environments.md). Refs are not secret.
- [x] Account → Access Tokens → create one named `github-actions`.
      Confirmed: the `SUPABASE_ACCESS_TOKEN` repository secret exists (8 September
      2026) and the `deploy-dev` workflow authenticates with it.

**Hand back:** the two project refs, the access token, and each project's
**Project URL** and **anon key** (Settings → API).

> Free projects pause after 7 days of no API requests. If `dev` looks broken
> after a quiet week, un-pause it before debugging anything else.

> **`circles-prod` is paused right now** — `list_projects` reports it `INACTIVE`,
> which is what a project created on 7 September and never called since looks
> like. Nothing is wrong with it, but it has to be resumed from the dashboard
> before any of steps 8 and 9 can be applied to it: a paused project answers no
> API call, so configuring a provider or setting a secret on it fails in a way
> that reads like a credentials problem.

## 2. Domain — free, and deferred

**No longer deferred, and now the first step that matters** (founder decision,
15 September 2026). It was deferred on 8 September because `dev` runs perfectly
well on the URL EAS Hosting assigns — `sushen25s-team-circles--dev.expo.app` —
and that is still true. What changed is that steps 7 and 8 bind vendor
configuration to hostnames: a Turnstile widget lists the hosts it will answer
for, a Google web OAuth client is bound to its origin, and an Apple Services ID
to its return URLs. Doing those against the `expo.app` host means doing them
twice, and the Google web client has to be **re-created** rather than edited,
because a client that has been live carries consent grants tied to it.

So the order is: **Turnstile, then the domain, then Apple and Google.** One DNS
session covers the app records here and Resend's records in step 5.

Turnstile comes before the domain rather than after it, despite the domain
being what the OAuth clients are waiting on, because attaching the domain
requires a production deployment and a production deploy refuses to run without
`EXPO_PUBLIC_TURNSTILE_SITE_KEY` (`REQUIRE_TURNSTILE=true`). Ordering the
domain first reads as the tidier sequence and is a deadlock: the domain waits
on the deploy, the deploy waits on Turnstile. Turnstile has nothing to wait
for — a widget lists hostnames without resolving them, so it can be created
before any of them exist.

The one hard boundary: **§5.2 forbids shipping links on `*.expo.app`**, and that
still holds. Before any invite link reaches a person who is not the founder, the
custom domain has to exist, because a link already in a group chat cannot be
recalled.

**EAS Hosting allows exactly one custom domain per project**, assigned to the
production deployment. This checklist used to ask for two; that was never
possible. Founder decision, 15 September 2026:

- [x] `meet.sushensatturu.com` — the `prod` app host, and **the one that takes
      the slot**. **Attached and Active, 15 September 2026.** All three records
      written to Route 53 (`Z02124241V4I670RZ3CSK`) and confirmed resolving
      through both `1.1.1.1` and `8.8.8.8`; certificate issued by Google Trust
      Services, valid to 14 December 2026. `meet`, not the codename: links already in a group chat keep
      working and keep saying whatever they said, so the one string you cannot
      take back should describe the job rather than the name (§5.4).
- [x] `dev.sushensatturu.com` — **not created.** `dev` stays on
      `sushen25s-team-circles--dev.expo.app`, which costs nothing, because §5.2
      binds links that reach a real person and `dev` never sends an invite.
      Expo's suggestion for a second name is a bare CNAME to `origin.expo.app`,
      but its documentation does not say whether a TLS certificate is issued
      for one, and an environment nobody outside sees is a poor place to find
      out. Google's web OAuth client lists both origins instead — the
      `expo.app` host and `meet` — which costs one line and no uncertainty.
- [x] `mail.meet.sushensatturu.com` — the sending domain. **Production only**;
      `dev` does not send. Done with Resend, step 6, in the same DNS session.

The records come from EAS and from Resend, and guessing them means deleting
them later. Attaching the domain is **dashboard-only** — `eas-cli` 23.2.0 has
no hosting or domain command, so there is nothing to automate here.

### Attaching `meet` in the EAS dashboard

<https://expo.dev/accounts/sushen25s-team/projects/circles/hosting> → settings →
custom domain. It then asks for three records, and the order matters — add each
one and refresh before adding the next, or the check runs against a record that
is not visible yet:

| # | Name | Type | Purpose |
|---|---|---|---|
| 1 | `_cf-custom-hostname.meet` | TXT | proves you own the domain |
| 2 | `_acme-challenge.meet` | CNAME | proves it to the certificate authority, so a certificate can be issued |
| 3 | `meet` | CNAME | routes requests, to `origin.expo.app` |

Only the third value is predictable; the first two carry per-domain tokens that
the dashboard generates.

> **The domain cannot be attached until production is deployed.** Not "will not
> serve" — the dashboard refuses to open the custom-domain form at all, with
> *"Create a production deployment first. You must promote a deployment to
> production before you can set up a custom domain."* Verified 15 September
> 2026. An earlier draft of this step assumed the attach could happen early and
> only the serving would wait; that was wrong, and it inverts the order.
>
> What a production deployment costs is the whole of step 4 plus a `deploy-prod`
> run, and that run is not only a web deploy: it does `supabase db push` and
> `supabase functions deploy` against `circles-prod` first. The first one
> stands production up for real.
>
> **The reorder this forces, and why it is cheap:** steps 7 and 8 need the
> hostname *settled*, not *resolving*. A Turnstile widget matches the hostname
> string a page is served from, and an OAuth client stores its origin as text;
> none of them check DNS at configuration time. `meet.sushensatturu.com` has
> been settled since 15 September. So Turnstile, Google and Apple can all be
> configured now, against a name that does not yet resolve, and the attach moves
> to whenever production is first deployed — S1-32's business, not this step's.
>
> Which also removes a circularity worth naming: `deploy-prod.yml` sets
> `REQUIRE_TURNSTILE: 'true'`, so a production deploy *fails* without
> `EXPO_PUBLIC_TURNSTILE_SITE_KEY`. Domain-before-Turnstile was never
> achievable. Turnstile comes first.

### How to add a record in Route 53

The zone already exists, so **do not create a hosted zone for the subdomain.**
A zone per subdomain costs US$0.50/month each and needs NS delegation records
glued back to the parent; it is the standard way to lose an afternoon here.

1. Route 53 → **Hosted zones** → `sushensatturu.com` → **Create record**.
2. **Record name**: type the part *before* the zone only — `meet`, not
   `meet.sushensatturu.com`. The console appends the rest and shows you the
   full name underneath. Getting this wrong gives you
   `meet.sushensatturu.com.sushensatturu.com`, which resolves for nobody.
3. **Record type**: as the vendor says — `CNAME` for the app hosts, `TXT` for
   SPF/DKIM/DMARC, `MX` for the bounce record.
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
      --dns-name sushensatturu.com --query 'HostedZones[0].Id' --output text)" \
  --change-batch '{"Changes":[{"Action":"UPSERT","ResourceRecordSet":{
      "Name":"meet.sushensatturu.com","Type":"CNAME","TTL":300,
      "ResourceRecords":[{"Value":"<target from EAS>"}]}}]}'
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
- [x] **Variables** (repository scope — these are the `dev` values, and previews
      read them):
      `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`,
      `EXPO_PUBLIC_APP_ORIGIN`. All three confirmed present.
      `APP_ORIGIN` is `https://sushen25s-team-circles--dev.expo.app`, and
      **never changes.** It is not a placeholder waiting for a domain: step 2
      settled that `dev` keeps the `expo.app` host permanently, because EAS
      Hosting allows one custom domain per project and `meet` takes it.
      Repository scope is read by `deploy-dev` and by every per-PR preview, so
      pointing it at `meet.sushensatturu.com` when the domain is attached would
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
      `EXPO_PUBLIC_APP_ORIGIN` = `https://meet.sushensatturu.com`, and
      `EXPO_PUBLIC_SUPABASE_URL` = `https://bhunoaqswteamabbyckp.supabase.co`.
- [x] `EXPO_PUBLIC_SUPABASE_ANON_KEY` on `production` — set 15 September 2026 to
      the **publishable** key (`sb_publishable_…`), matching the form `dev`
      uses rather than the legacy `anon` JWT. Public, like the `dev` one in the
      repository variables. A production deploy fails the client-config check
      without it, which is what it was doing.
- [ ] Environments → `production` → add yourself as a **required reviewer**, so a
      production deploy pauses for a human.
      **Blocked, not forgotten:** environment protection rules on a *private*
      repository need GitHub Pro, Team or Enterprise, and this repository is
      private on a free plan — the environment was created with
      `protection_rules: []` and `dev` has none either. Until the plan changes
      or the repository goes public, `deploy-prod.yml` has an `environment:`
      to attach to but no approval gate behind it, and its `confirm` input is
      the only thing between a mis-click and production. This is the same plan
      question as branch protection on `main` (see the end of this file), and
      it is the last of SUS-71's acceptance criteria that cannot be met by
      configuration alone.

> Variables, not secrets, on purpose: they are compiled into the client bundle
> and readable by anyone. Calling them secret teaches the word to mean nothing.

## 5. DNS and email authentication

- [x] **No app-host records here.** `dev` serves from
      `sushen25s-team-circles--dev.expo.app` permanently and `dev.sushensatturu.com`
      is never created (step 2). `meet`'s three records come with the domain
      attach, which cannot happen until production is deployed — also step 2.
      What is left in this step is email, and email alone.
- [x] Resend → add domain **`mail.meet.sushensatturu.com`**. Added 15 September
      2026, region `ap-northeast-1` (Tokyo). Production only — `dev` does not
      send, and a second sending domain is a second set of records to keep warm
      for no benefit yet.

      That is a third region in the stack, after `circles-dev` in `ap-south-1`
      and `circles-prod` in `ap-southeast-1`, and like theirs it is fixed at
      creation. It does not matter much for email, which is asynchronous; it is
      recorded so nobody later reads it as a mistake.
- [x] Add Resend's records. Written 15 September 2026 and verified resolving
      through both `1.1.1.1` and `8.8.8.8`.

      **Resend now delegates by CNAME rather than handing you an SPF TXT and an
      MX directly**, which is not what the rest of this step used to describe:

      | Name | Type | Value |
      | --- | --- | --- |
      | `resend._domainkey.mail.meet` | TXT | `p=MIGf…QAB` (1024-bit, 218 chars) |
      | `send.mail.meet` | CNAME | `send.forge.rmta.net` |
      | `rsend.mail.meet` | CNAME | `rsend-apne1.forge.rmta.net` |

      The effect is the same and `check:env` passes unchanged, because
      resolution follows the CNAME: `send.mail.meet` answers a TXT query with
      `v=spf1 ip4:… ~all` and an MX query with `10 feedback.forge.rmta.net`,
      both from the target. DKIM still sits at `resend._domainkey.mail.meet`,
      because that is the name that has to align with the header `From`.

      Three traps in that table. **`rsend` is not a typo of `send`** — it is a
      separate record pairing with `rsend-apne1`, and both are required. **A
      CNAME cannot coexist with any other record at the same name**, so nothing
      else may ever be added at `send.mail.meet` or `rsend.mail.meet`. And the
      **bounce MX is the one people skip** — here it arrives through the
      `send.` CNAME rather than as its own record, so it is easy to believe it
      is missing; without it Resend cannot tell a hard bounce from silence and
      the suppression list never fills.

      The DKIM value needed no splitting: at 218 characters it is under the
      255-character limit for a single TXT string. It also carries no
      `v=DKIM1; k=rsa;` prefix, just a bare `p=`, which is valid — RFC 6376
      makes `v=` optional and defaults it to `DKIM1`.
- [x] Add DMARC on `_dmarc.mail.meet`. Written 15 September 2026 as
      `"v=DMARC1; p=none"`, and verified resolving through both `1.1.1.1` and
      `8.8.8.8`, which are the resolvers `check-environment.mjs` uses.

      `p=none` first — it reports without rejecting, so a misconfiguration costs
      you a report rather than every email. Raise to `p=quarantine` after a week
      of clean reports.

      **`rua=` is deliberately absent, and a personal address is not the way to
      add it.** RFC 7489 §7.1: when the reporting address sits at a different
      domain from the DMARC record, the reporting party must first find a
      `v=DMARC1` TXT at
      `mail.meet.sushensatturu.com._report._dmarc.<rua-domain>`. Checked on 15
      September: `gmail.com` publishes no such record and has no
      `_report._dmarc` namespace at all, and Google, Microsoft and Yahoo all
      enforce the check — so a Gmail `rua` publishes an address in public DNS
      and collects almost nothing. The same objection applies to an address on
      the apex, since that is still a different domain and implementations
      disagree about organisational-domain matches.

      The arrangements that work are a reporting service (Postmark DMARC
      Digests, Dmarcian — both free, and both publish the `_report._dmarc`
      authorisation so reports actually arrive) or no `rua` at all. Nothing
      sends until S1-19, so there is nothing to report on yet; wire a service
      then, as a one-record edit.
- [x] Wait for Resend to show the domain **verified** (minutes to hours). The
      records are live; this is Resend's own check catching up.
- [x] Verify from the outside — **seven of seven, 15 September 2026**, the first
      time this has passed:

```bash
pnpm check:env meet.sushensatturu.com
pnpm check:env sushen25s-team-circles--dev.expo.app --no-email
```

There are **seven** checks, not six: HTTPS, HSTS and `Referrer-Policy` on the
host, then SPF, DKIM, bounce MX and DMARC on the sending domain. The last three
app checks only run if the first one connects, so a host that does not resolve
reports one failure rather than three.

As of 15 September 2026 `meet` reports **four of five**: all four email checks
pass, and `HTTPS serves the app` fails with `fetch failed` because `meet` has
no record at all until the domain is attached — which needs a production
deploy (step 2). That failure is the honest state of things, not a
misconfiguration, and it is the last thing standing between this file and a
green run.

The second command names the `expo.app` host because `dev.sushensatturu.com` is
never created (step 2).

`Referrer-Policy: no-referrer` matters more than it looks: invite secrets ride
in the URL fragment, and a leaked referrer is how they escape (§14).

## 6. Resend

**Deferred** (SUS-71, founder decision 8 Sep 2026). No environment sends real
email; testing happens locally against Mailpit — see
[`environments.md`](./environments.md). Due before S1-19.

- [x] API Keys → create one, **sending permission only**, named `circles-prod`.
      Set on `circles-prod` as `RESEND_API_KEY`. Not on `circles-dev`, and that
      is correct: `dev` does not send, and email is tested against Mailpit.
- [ ] Webhooks → add an endpoint. The URL is the `email-provider-webhook`
      function, which **does not exist until S1-19** — either come back for this
      one, or create it now against the expected URL and expect failures until
      then. Either is fine; leaving it undone silently is not, because bounces
      then go unrecorded.
- [ ] Copy the **webhook signing secret**.

**Hand back:** the API key and the webhook secret.

## 7. Cloudflare Turnstile — free

**This is now the first vendor step, ahead of the domain** (15 September 2026).
`deploy-prod.yml` sets `REQUIRE_TURNSTILE: 'true'`, so a production deploy fails
without the site key — and a production deploy is what unlocks attaching the
custom domain. Turnstile therefore cannot come after the domain; it comes first.
Due before S1-14.

- [x] Turnstile → add a widget, **Invisible** mode. Done 15 September 2026. Hostnames:
      `meet.sushensatturu.com`, `sushen25s-team-circles--dev.expo.app` and
      `localhost`. **Not `dev.sushensatturu.com`** — that name is never created
      (step 2), so listing it protects nothing.

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

Verified off on both projects (`/auth/v1/settings` reports `apple: false,
google: false`). Due before S1-14.

Slower than the rest; both can be done after Slice 1 starts, but before S1-14
lands.

**The name has to be settled, not attached.** Founder decision, 15 September
2026: create the web client once, against the final origin, rather than against
the `expo.app` host and again later — the client that would be re-created is
the one carrying real consent grants. But an OAuth client stores its origin as
text and checks no DNS when you save it, so "settled" is the whole
requirement, and `meet.sushensatturu.com` has been settled since 15 September.
Do not wait for step 2's attachment, which needs a production deployment that
in turn waits on S1-32.

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
      `https://meet.sushensatturu.com` and
      `https://sushen25s-team-circles--dev.expo.app`), iOS (bundle
      `app.circles.production`), Android (package + SHA-1 from EAS
      credentials).
      **The `expo.app` host, not `dev.sushensatturu.com`** — step 2 decided
      that name is never created, and an origin that does not exist authorises
      nothing while the origin that does is rejected as a mismatch.
- [ ] Supabase → Authentication → Providers → configure Apple and Google on
      **both** projects.

> The Google **web** client is bound to the origin. When the holding domain is
> replaced, re-create it rather than editing it.

## 9. Secrets onto the projects

Never into the repository, never into `.env`. For each project:

```bash
supabase secrets set --project-ref <ref> \
  RESEND_API_KEY=... \
  RESEND_WEBHOOK_SECRET=... \
  TURNSTILE_SECRET_KEY=... \
  APPLE_TEAM_ID=... APPLE_KEY_ID=... APPLE_SERVICES_ID=... \
  GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=...
```

**`TURNSTILE_SECRET_KEY` is the one value that differs between the two
projects, and copying the real one to both breaks `dev`.** Step 7 puts the
dummy *site* key at repository scope, so `dev` and every per-PR preview send a
dummy token — and a real secret rejects a dummy token, which is the same
property that makes a half-swapped pair fail closed. The result would be that
every web join against `dev` fails Turnstile verification, in an environment
whose whole job is to find that out before production does. So:

| Project | `TURNSTILE_SECRET_KEY` |
|---|---|
| `circles-dev` (`pcfekupwqrdfryeaqggx`) | `1x0000000000000000000000000000000AA` — the always-passes dummy, matching the dummy site key at repository scope |
| `circles-prod` (`bhunoaqswteamabbyckp`) | the real secret from step 7 |

Every other secret in the block is the same on both.

The Apple private key is a file, so it goes as its contents:

```bash
supabase secrets set --project-ref <ref> APPLE_PRIVATE_KEY="$(cat AuthKey_XXXX.p8)"
```

**Where this stands, 15 September 2026.** Everything but Apple and Google is set;
those wait on S1-14b, which is why this step cannot be ticked whole:

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
S1-20 needs the same string again for `circles.cron_secret`.

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

- **`support@meet.sushensatturu.com` receives nothing.** It is in `brand.ts` and
  will appear in transactional email, but the zone has no MX for it. Before
  S1-19 sends anything, either arrange forwarding (SES receipt rule, or a
  forwarding service) or change `supportEmail` to an address that exists.
  A support address that silently drops replies is worse than none.

- **Store accounts** (Apple Developer US$99/yr, Play US$25 once) — Slice 3, S3-01.
- **Supabase Pro** on `prod` — Slice 4, before the external cohort.
- **Branch protection on `main`** — needs GitHub Pro on a private repository, or
  making the repository public. Until then CI can be bypassed by anyone who
  chooses to.
