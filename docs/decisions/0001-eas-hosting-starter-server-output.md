# ADR 0001: Host the web app on EAS Hosting (Starter) with Expo Router `server` output

_Status: accepted · Date: 6 September 2026_

## Context
The invite link is the product's first brand moment and its trust argument. The spec (v2 §3) requires a custom domain from Slice 1 and per-link Open Graph previews carrying the circle name only. EAS Hosting's Free plan does not allow custom domains; Starter (US$19/month) allows one per project. Expo Router's `server` output is the only officially documented way to run an API route (needed for OG tags) alongside the universal app; third-party adapters (Vercel, Netlify) are marked unofficial.

## Decision
Deploy the web build of the Expo app to EAS Hosting on the Starter plan under a custom domain, with `web.output: "server"`. Exactly one server route exists in the app (`app/og/[kind]+api.ts`) and it serves link-preview HTML only. All other server responsibilities stay in Supabase.

## Alternatives considered
- **Cloudflare Pages + a Worker for OG tags with `single` output** — cheaper and static, but a second deployment path and a second place to keep routes in sync.
- **Vercel or Netlify adapters** — unofficial, "subject to breaking changes".
- **No dynamic previews** — loses the first brand moment in the chat and the review's evidence that previews matter for tap-through.

## Consequences
- US$19/month from Slice 1. The holding domain will be replaced before the external cohort; Google sign-in on web must be re-verified for the new origin.
- Native builds must set `origin` in `app.config.ts` so relative fetches to the OG route resolve; the app itself never calls that route.
- The OG route must never read anything but a circle's name via a rate-limited definer function keyed by short code.
