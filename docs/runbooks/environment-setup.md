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
- [ ] On **both**: Authentication → Rate Limits → anonymous sign-ins **60/hour per IP**.
      The default is far lower and breaks households behind one address (§14).
      **Not verifiable from outside** — no API exposes it. Read it off the
      dashboard, or it will be found the first time a household is locked out.
- [x] Copy each **project ref** (the subdomain in the project URL) into the table
      in [`environments.md`](./environments.md). Refs are not secret.
- [ ] Account → Access Tokens → create one named `github-actions`.

**Hand back:** the two project refs, the access token, and each project's
**Project URL** and **anon key** (Settings → API).

> Free projects pause after 7 days of no API requests. If `dev` looks broken
> after a quiet week, un-pause it before debugging anything else.

## 2. Domain — ~US$20/year

- [ ] Buy a **neutral holding domain**. It is temporary: the real one gets
      chosen with the product name, so pick something short and unloved, and do
      not put the word "circles" in it — nothing may assume the final name (§5.4).
- [ ] Use a registrar whose DNS panel you can edit directly (Cloudflare,
      Porkbun, Namecheap). You will be adding TXT records in step 5.

**Hand back:** the domain.

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
      `EXPO_PUBLIC_APP_ORIGIN` (`https://<domain>`).
- [ ] Environments → `production` → **Variables**: the same three names with the
      **prod** project's values. These override the repository ones for
      production deploys only.
- [ ] Environments → `production` → add yourself as a **required reviewer**, so a
      production deploy pauses for a human.

> Variables, not secrets, on purpose: they are compiled into the client bundle
> and readable by anyone. Calling them secret teaches the word to mean nothing.

## 5. DNS and email authentication

- [ ] EAS Hosting → attach the custom domain; add the records it asks for.
- [ ] Resend → add domain **`mail.<domain>`** (the subdomain, not the apex).
- [ ] Add Resend's **SPF** and **DKIM** records to DNS, exactly as shown there.
- [ ] Add DMARC on `_dmarc.mail`: `v=DMARC1; p=none; rua=mailto:<your address>`.
      `p=none` first — it reports without rejecting, so a misconfiguration costs
      you a report rather than every email. Raise to `p=quarantine` after a week
      of clean reports.
- [ ] Wait for Resend to show the domain **verified** (minutes to hours).
- [ ] Verify from the outside:

```bash
pnpm check:env <domain>
```

All six checks must pass. `Referrer-Policy: no-referrer` matters more than it
looks: invite secrets ride in the URL fragment, and a leaked referrer is how
they escape (§14).

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

- [ ] Turnstile → add a widget, **Invisible** mode, hostname `<domain>`.
- [ ] Add `localhost` as a second hostname so local development works.

**Hand back:** the **site key** (public → GitHub variables as
`EXPO_PUBLIC_TURNSTILE_SITE_KEY`) and the **secret key** (→ step 9).

## 8. Apple and Google sign-in

Slower than the rest; both can be done after Slice 1 starts, but before S1-14
lands.

- [ ] Apple Developer → **Services ID** for the web sign-in; return URL is
      `https://<supabase-project>.supabase.co/auth/v1/callback`.
- [ ] Apple → **Sign in with Apple key**; download the `.p8` **once** — it
      cannot be downloaded twice.
- [ ] Google Cloud → OAuth consent screen, then **three** clients: web (origin
      `https://<domain>`), iOS (bundle `app.circles.production`), Android
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

- [ ] Set on `circles-dev`.
- [ ] Set on `circles-prod`.
- [ ] `supabase secrets list --project-ref <ref>` on both — it prints names and
      digests, never values. Confirm the names match
      [`environments.md`](./environments.md).
- [ ] Delete the `.p8` from Downloads.

## 10. Confirm the whole thing

- [ ] `pnpm check:env <domain>` — six for six.
- [ ] Push to `main`; the `deploy-dev` run summary shows Supabase and Expo both
      `true` rather than "waiting on S0-11".
- [ ] `https://<domain>/` serves the app.
- [ ] Open a throwaway PR and confirm the preview URL is posted on it.
- [ ] gitleaks green on that PR — nothing from this checklist reached the repo.

---

## What is still not done after this

- **Store accounts** (Apple Developer US$99/yr, Play US$25 once) — Slice 3, S3-01.
- **Supabase Pro** on `prod` — Slice 4, before the external cohort.
- **Branch protection on `main`** — needs GitHub Pro on a private repository, or
  making the repository public. Until then CI can be bypassed by anyone who
  chooses to.
