# apps/app

The Expo universal app: web (guests and organisers), iOS and Android from one
codebase. Web output is `server` so exactly one API route can serve link
previews (ADR 0001); nothing else uses server rendering.

## Run

```bash
pnpm build            # from the repo root: app.config.ts imports @circles/config
pnpm --filter app start
```

`start` opens the Expo dev server; press `w` for web, `i` for the iOS simulator,
`a` for the Android emulator. `pnpm --filter app export` produces the web build
in `dist/` (`dist/client` and `dist/server`).

Copy `.env.example` to `.env.local` and fill it in as the values arrive (S0-06
for the local Supabase stack, S0-11 for the hosted projects).

## Configuration

`app.config.ts` is the whole app definition. It reads:

| Source                                                      | What                                                                                                               |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `@circles/config` `brand`                                   | display name, deep-link scheme, link host (§5.4)                                                                   |
| `EXPO_PUBLIC_APP_ENV`                                       | `development` \| `preview` \| `production` — picks the bundle id `app.circles.<env>` and the EAS channel           |
| `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` | the only backend credentials in the client bundle (§5.3)                                                           |
| `EXPO_PUBLIC_TURNSTILE_SITE_KEY`                            | anonymous-join bot protection; public by design                                                                    |
| `EXPO_PUBLIC_APP_ORIGIN`                                    | overrides the brand domain; also sets Expo's `origin` so native relative fetches to the link-preview route resolve |

No product name, domain or sender is written anywhere but `packages/config/src/brand.ts`.
`pnpm check:brand` fails the build if one creeps in.

## EAS

`eas.json` defines `development`, `preview` and `production`, each with a
matching EAS Update channel. The EAS project itself is created once, by a human
with an Expo account:

```bash
eas login
eas init
eas update:configure
```

`eas init` prints a project id. Because the app is configured in `app.config.ts`
rather than `app.json`, it cannot write the id back — put it in your environment
(and in the EAS/CI environment) as `EAS_PROJECT_ID`; `app.config.ts` reads it
into `extra.eas.projectId`.

## Structure

`app/` holds Expo Router routes only — thin composition, no logic. Screen logic
lives in `src/features` (S0-08), the design system in `src/components` (S0-04),
adapters in `src/platform`, typed reads in `src/data`, strings in `src/copy`,
events in `src/analytics`. Those boundaries are already enforced by
`eslint-plugin-boundaries` (architecture §7.2): `data` and `platform` never
import `features`.
