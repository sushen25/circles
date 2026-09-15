# Environment setup checklist

One-time. Every step here needs an account, a card or a DNS panel, so it is the
founder's to do — the agent side (config, guards, docs, CI wiring) is already
committed and waiting for these values.

Work top to bottom: later steps need earlier ones. Tick as you go. Nothing here
is reversible-by-accident, but **step 3 costs money** and **step 2 spends about
US$20/year**.

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

So the order is: domain, then Turnstile, then Apple and Google. One DNS session
covers the app records here and Resend's records in step 5.

The one hard boundary: **§5.2 forbids shipping links on `*.expo.app`**, and that
still holds. Before any invite link reaches a person who is not the founder, the
custom domain has to exist, because a link already in a group chat cannot be
recalled.

**EAS Hosting allows exactly one custom domain per project**, assigned to the
production deployment. This checklist used to ask for two; that was never
possible. Founder decision, 15 September 2026:

- [ ] `meet.sushensatturu.com` — the `prod` app host, and **the one that takes
      the slot**. `meet`, not the codename: links already in a group chat keep
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
- [ ] `mail.meet.sushensatturu.com` — the sending domain. **Production only**;
      `dev` does not send. Comes with Resend, step 6, in this same DNS session.

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

> **`meet` will serve nothing until production is deployed**, because the custom
> domain points at the production deployment and there has never been one. So
> `pnpm check:env meet.sushensatturu.com` cannot pass its first row on DNS
> alone — it needs step 4's `production` environment, a resumed `circles-prod`,
> and one `deploy-prod` run. Attaching the domain early is still right: the
> certificate takes time, and steps 7 and 8 need the name to be settled.

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

- [x] Upgrade the `@sushen25` account to **Starter**: <https://expo.dev/accounts/sushen25/settings/billing>
      Taken on the founder's word, and corroborated: the `dev` alias serves.
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
      `APP_ORIGIN` is `https://sushen25s-team-circles--dev.expo.app`, **not**
      `https://dev.sushensatturu.com`, because step 2 is deferred and `dev` has
      no custom domain. Change it when the domain is attached, not before — an
      origin that does not resolve is worse than an ugly one that does.
- [ ] `EXPO_PUBLIC_TURNSTILE_SITE_KEY` (repository scope). **Missing**, and
      that is step 7. Anonymous joins on the deployed app are ungated until it
      is set. Confirmed absent from both the repository and the `dev`
      environment.
- [ ] Environments → `production` → **Variables**: the same names with the
      **prod** project's values, and `EXPO_PUBLIC_APP_ORIGIN` =
      `https://meet.sushensatturu.com`. These override the repository ones for
      production deploys only.
      **The `production` environment does not exist** — `dev` is the only one.
      Create it here; `deploy-prod.yml` already names it, so until it exists a
      production deploy has no approval gate to wait on.
- [ ] Environments → `production` → add yourself as a **required reviewer**, so a
      production deploy pauses for a human.

> Variables, not secrets, on purpose: they are compiled into the client bundle
> and readable by anyone. Calling them secret teaches the word to mean nothing.

## 5. DNS and email authentication

- [ ] **Deferred.** No custom domain is attached; `dev` serves from
      `sushen25s-team-circles--dev.expo.app`. When the domain is added, attach
      `dev.sushensatturu.com` in EAS Hosting and add the records it asks for,
      per the Route 53 notes in step 2.
- [ ] Resend → add domain **`mail.meet.sushensatturu.com`**. Production only —
      `dev` does not send, and a second sending domain is a second set of
      records to keep warm for no benefit yet.
- [ ] Add Resend's **SPF**, **DKIM** and **bounce MX** records exactly as shown.
      Note that SPF and the MX go on `send.mail.meet`, a child of the sending
      domain, while DKIM goes on `resend._domainkey.mail.meet`. The bounce MX is
      the one people skip; without it Resend cannot tell a hard bounce from
      silence and the suppression list never fills.
- [ ] Add DMARC on `_dmarc.mail.meet`:
      `"v=DMARC1; p=none; rua=mailto:<your address>"`.
      `p=none` first — it reports without rejecting, so a misconfiguration costs
      you a report rather than every email. Raise to `p=quarantine` after a week
      of clean reports.
- [ ] Wait for Resend to show the domain **verified** (minutes to hours).
- [ ] Verify from the outside:

```bash
pnpm check:env meet.sushensatturu.com
pnpm check:env dev.sushensatturu.com --no-email
```

Production must be six for six; `dev` is the app checks only. Both currently
report every record as missing and name each one, which is the shopping list.

`Referrer-Policy: no-referrer` matters more than it looks: invite secrets ride
in the URL fragment, and a leaked referrer is how they escape (§14).

## 6. Resend

**Deferred** (SUS-71, founder decision 8 Sep 2026). No environment sends real
email; testing happens locally against Mailpit — see
[`environments.md`](./environments.md). Due before S1-19.

- [ ] API Keys → create one, **sending permission only**, named `circles-prod`.
- [ ] Webhooks → add an endpoint. The URL is the `email-provider-webhook`
      function, which **does not exist until S1-19** — either come back for this
      one, or create it now against the expected URL and expect failures until
      then. Either is fine; leaving it undone silently is not, because bounces
      then go unrecorded.
- [ ] Copy the **webhook signing secret**.

**Hand back:** the API key and the webhook secret.

## 7. Cloudflare Turnstile — free

**Deferred** (SUS-71). Anonymous joins are ungated on the deployed app, which
is harmless while nothing real is deployed. `check-client-env.mjs` already
refuses a **production** deploy without it, so this cannot be forgotten into
production. Due before S1-14.

- [ ] Turnstile → add a widget, **Invisible** mode. Add all three hostnames:
      `meet.sushensatturu.com`, `dev.sushensatturu.com` and `localhost`.

**Hand back:** the **site key** (public → GitHub variables as
`EXPO_PUBLIC_TURNSTILE_SITE_KEY`) and the **secret key** (→ step 9).

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

## 8. Apple and Google sign-in

Verified off on both projects (`/auth/v1/settings` reports `apple: false,
google: false`). Due before S1-14.

Slower than the rest; both can be done after Slice 1 starts, but before S1-14
lands.

**Do step 2 first.** Founder decision, 15 September 2026: attach the domain
before creating any OAuth client, so one web client covers both origins and is
created once. The alternative considered was a throwaway dev client against the
`expo.app` origin to unblock S1-14 sooner; it was not taken, because the client
that would have to be re-created later is the one carrying real consent grants.

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
      `https://meet.sushensatturu.com` and `https://dev.sushensatturu.com`),
      iOS (bundle `app.circles.production`), Android
      (package + SHA-1 from EAS credentials).
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
  TURNSTILE_SECRET=... \
  APPLE_TEAM_ID=... APPLE_KEY_ID=... APPLE_SERVICES_ID=... \
  GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=...
```

The Apple private key is a file, so it goes as its contents:

```bash
supabase secrets set --project-ref <ref> APPLE_PRIVATE_KEY="$(cat AuthKey_XXXX.p8)"
```

- [ ] Set on `circles-dev` (`pcfekupwqrdfryeaqggx`).
- [ ] Set on `circles-prod` (`bhunoaqswteamabbyckp`).
- [ ] `supabase secrets list --project-ref <ref>` on both — it prints names and
      digests, never values. Confirm the names match
      [`environments.md`](./environments.md).
- [ ] Delete the `.p8` from Downloads.

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
