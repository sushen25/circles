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
- [ ] Account → Access Tokens → create one named `github-actions`.

**Hand back:** the two project refs, the access token, and each project's
**Project URL** and **anon key** (Settings → API).

> Free projects pause after 7 days of no API requests. If `dev` looks broken
> after a quiet week, un-pause it before debugging anything else.

## 2. Domain — free

Settled: subdomains of the founder's existing Route 53 zone `sushensatturu.com`,
rather than buying anything. They are temporary and get replaced when the product
is named.

- [x] `dev.sushensatturu.com` — the `dev` app host.
- [x] `meet.sushensatturu.com` — the `prod` app host. `meet`, not the codename:
      links already in a group chat keep working and keep saying whatever they
      said, so the one string you cannot take back should describe the job
      rather than the name (§5.4).
- [x] `mail.meet.sushensatturu.com` — the sending domain. **Production only**;
      `dev` does not send.

Nothing to create yet. The records come from EAS (step 3) and Resend (step 6),
and guessing them means deleting them later.

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

- [ ] Upgrade the `@sushen25` account to **Starter**: <https://expo.dev/accounts/sushen25/settings/billing>
- [ ] Create an **access token** (Account → Access Tokens) named `github-actions`.

**Hand back:** the token.

> This is the only recurring charge right now. Cancel it and previews and the
> deployed web app stop; nothing else breaks.

## 4. Tell CI about all of that

In the repository settings, **Secrets and variables → Actions**:

- [ ] Secrets → `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DEV_PROJECT_REF`,
      `SUPABASE_PROD_PROJECT_REF`, `EXPO_TOKEN`.
- [ ] **Variables** (repository scope — these are the `dev` values, and previews
      read them):
      `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`,
      `EXPO_PUBLIC_APP_ORIGIN` = `https://dev.sushensatturu.com`.
- [ ] Environments → `production` → **Variables**: the same three names with the
      **prod** project's values, and `EXPO_PUBLIC_APP_ORIGIN` =
      `https://meet.sushensatturu.com`. These override the repository ones for
      production deploys only.
- [ ] Environments → `production` → add yourself as a **required reviewer**, so a
      production deploy pauses for a human.

> Variables, not secrets, on purpose: they are compiled into the client bundle
> and readable by anyone. Calling them secret teaches the word to mean nothing.

## 5. DNS and email authentication

- [ ] EAS Hosting → attach **both** `meet.sushensatturu.com` and
      `dev.sushensatturu.com`; add the records it asks for, per the Route 53
      notes in step 2.
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

- [ ] API Keys → create one, **sending permission only**, named `circles-prod`.
- [ ] Webhooks → add an endpoint. The URL is the `email-provider-webhook`
      function, which **does not exist until S1-19** — either come back for this
      one, or create it now against the expected URL and expect failures until
      then. Either is fine; leaving it undone silently is not, because bounces
      then go unrecorded.
- [ ] Copy the **webhook signing secret**.

**Hand back:** the API key and the webhook secret.

## 7. Cloudflare Turnstile — free

- [ ] Turnstile → add a widget, **Invisible** mode. Add all three hostnames:
      `meet.sushensatturu.com`, `dev.sushensatturu.com` and `localhost`.

**Hand back:** the **site key** (public → GitHub variables as
`EXPO_PUBLIC_TURNSTILE_SITE_KEY`) and the **secret key** (→ step 9).

## 8. Apple and Google sign-in

Slower than the rest; both can be done after Slice 1 starts, but before S1-14
lands.

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

- [ ] `pnpm check:env meet.sushensatturu.com` — six for six, and
      `pnpm check:env dev.sushensatturu.com --no-email`.
- [ ] Push to `main`; the `deploy-dev` run summary shows Supabase and Expo both
      `true` rather than "waiting on S0-11".
- [ ] `https://meet.sushensatturu.com/` serves the app.
- [ ] Open a throwaway PR and confirm the preview URL is posted on it.
- [ ] gitleaks green on that PR — nothing from this checklist reached the repo.

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
