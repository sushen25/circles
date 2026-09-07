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
| Project ref | n/a | _fill in at setup_ | _fill in at setup_ |

`local` is the only one that exists today. The other two columns are filled in
by [`environment-setup.md`](./environment-setup.md).

Free Supabase projects **pause after seven days of inactivity**, and a pg_cron
heartbeat does not prevent it — pausing is measured on API requests, not
database activity. A paused `dev` looks exactly like a broken deploy. `prod`
moves to Pro the week the first non-founder circle is recruited (§5.1).

## Domains

One domain serves the app and the links. Until the product is named, it is a
neutral holding domain (§5.2, ADR 0001) — nothing may assume it. Everything
user-visible reads from [`packages/config/src/brand.ts`](../../packages/config/src/brand.ts);
changing the domain is an edit to that file plus the DNS and vendor steps below.

Links are **never** shipped on `*.expo.app`.

| Record | Host | Purpose |
|---|---|---|
| app | `@` and `www` | EAS Hosting, per its dashboard instructions |
| SPF | `mail` | `v=spf1 include:amazonses.com ~all` (Resend's value; take it from their dashboard, not from here) |
| DKIM | `resend._domainkey.mail` | Resend's key |
| DMARC | `_dmarc.mail` | `p=none` at first, `p=quarantine` after warm-up |

`.well-known/` on the apex is reserved for `apple-app-site-association` and
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

`scripts/check-client-env.mjs` runs before every deploy and fails if one is
missing or malformed. An `expo export` with no Supabase URL builds and deploys
perfectly happily, and every request fails in the browser.

**Secret — set with `supabase secrets set`, on both projects:**

| Name | From |
|---|---|
| `RESEND_API_KEY` | Resend → API Keys |
| `RESEND_WEBHOOK_SECRET` | Resend → Webhooks, on the endpoint |
| `TURNSTILE_SECRET` | Cloudflare → Turnstile, pairs with the site key |
| `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`, `APPLE_SERVICES_ID` | Apple Developer |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Cloud → Credentials |

The service-role key is never set by hand: Supabase injects it into functions.
It must not appear in the client or the repository (§14). gitleaks runs on every
PR; a green run is evidence, not a formality.

**GitHub secrets** (deploy credentials, genuinely secret):
`SUPABASE_ACCESS_TOKEN`, `SUPABASE_DEV_PROJECT_REF`, `SUPABASE_PROD_PROJECT_REF`,
`EXPO_TOKEN`.

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
5. Turnstile: the widget is bound to a hostname — add the new one.
6. **Google OAuth: the web client must be re-created.** Authorised origins can
   be edited, but a client that has been live on the old origin carries consent
   grants tied to it; re-create rather than edit.
7. Apple: update the Services ID's return URLs.
8. `EXPO_PUBLIC_APP_ORIGIN` in the GitHub variables, both scopes.
9. `pnpm check:env <new domain>`.
