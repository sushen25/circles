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
matching EAS Update channel. The project is **@sushen25/circles**; its id is in
`app.config.ts`, along with the EAS Update URL and an `appVersion` runtime
version policy. (`eas update:configure` cannot write into a dynamic config, so
those three values are set by hand — that is the whole of what it does.)

Run EAS commands from this directory, not the repository root: `eas init` at the
root writes a stray `app.json` next to `package.json` and then fails, because
`expo` is not a dependency there.

### Development builds

Architecture §4 targets EAS Build development clients; Expo Go is not a target.
`pnpm --filter app ios` runs `expo run:ios`, which needs Xcode and CocoaPods.

**Local iOS builds are currently broken on Xcode 26.2** — `expo-modules-jsi@57.0.8`
(the newest release for SDK 57) does not compile against its Swift/C++ interop:
`SWIFT_RETURNS_RETAINED` on a non-shared-reference type, and, past that, Swift 6
strict-concurrency errors in `JavaScriptRuntime.swift`. Nothing in this
repository can fix it. Use EAS Build, which pins its own Xcode, or an older
local Xcode, until Expo ships a fix.

## Structure

`app/` holds Expo Router routes only — thin composition, no logic. Screen logic
lives in `src/features` (S0-08), the design system in `src/components` (S0-04),
adapters in `src/platform`, typed reads in `src/data`, strings in `src/copy`,
events in `src/analytics`. Those boundaries are already enforced by
`eslint-plugin-boundaries` (architecture §7.2): `data` and `platform` never
import `features`.
