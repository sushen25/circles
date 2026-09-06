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

## Running on iOS

Three routes, in increasing order of fidelity and effort. Architecture §4 targets
EAS Build development clients and says Expo Go is not a target — but Expo Go is
still the right tool while there is no custom native code to exercise.

| Route                    | Use it for                                                        | Cost                               |
| ------------------------ | ----------------------------------------------------------------- | ---------------------------------- |
| Expo Go                  | anything pure JS/RN — tokens, components, routes, most of Slice 1 | free, instant                      |
| EAS simulator dev client | the first native module; anything Expo Go cannot load             | a build from the monthly allowance |
| Local `expo run:ios`     | fast native iteration                                             | free, but see the blocker below    |

### 1. Expo Go

```bash
pnpm --filter app start   # then press i
```

Every module the app uses today (`expo-router`, `expo-font`, `expo-secure-store`,
`expo-splash-screen`) ships inside Expo Go. It stops being enough the moment a
module Expo Go does not bundle arrives — `expo-calendar` and push in Slice 3 —
or a config plugin changes native code.

Note that `pnpm --filter app ios` is **not** Expo Go: `expo prebuild` repointed it
at `expo run:ios`, which is the local native build below.

### 2. EAS simulator development client

Builds on Expo's pinned Xcode, so it is immune to whatever is installed locally.
A simulator build needs **no Apple Developer account**, so it does not pull the
Slice 3 membership forward.

```bash
cd apps/app
eas build --profile development-simulator --platform ios
```

Then unpack what it gives you and:

```bash
xcrun simctl install booted /path/to/Circles.app
pnpm --filter app start --dev-client
```

You build the client **once** and reload JS over it; rebuild only when native
dependencies change (a new `expo-*` module, a config plugin, an SDK upgrade).
The `development-simulator` profile in `eas.json` extends `development` and only
adds `ios.simulator`, so the channel and environment stay identical.

### 3. Local builds — blocked today, and how to unblock them

```bash
pnpm --filter app ios      # expo run:ios
```

Needs Xcode and CocoaPods (both installed on the founder's machine). It generates
`ios/` via prebuild; that directory is disposable and git-ignored — never edit it
by hand, delete it and rebuild instead.

**This does not currently compile on Xcode 26.2.** `expo-modules-jsi@57.0.8` —
the newest release for SDK 57 — does not build against Xcode 26.2's Swift
toolchain, in two separate ways:

1. `apple/Sources/ExpoModulesJSI-Cxx/include/RuntimeScheduler.h:53` and `:61` —
   `SWIFT_RETURNS_RETAINED` applied to a type that is not a
   `SWIFT_SHARED_REFERENCE`, which newer Swift/C++ interop rejects.
2. With those removed, `apple/Sources/ExpoModulesJSI/Runtime/JavaScriptRuntime.swift`
   `:773`, `:815`, `:816` fail Swift 6 strict concurrency —
   _"sending 'thisPtr' risks causing data races"_.

It is a family of incompatibilities rather than a one-line patch, and nothing in
this repository can fix it. Two ways out:

**Use an older Xcode.** If another Xcode is installed, point just this build at
it — `DEVELOPER_DIR` avoids `sudo xcode-select` and leaves the rest of the
machine alone:

```bash
DEVELOPER_DIR=/Applications/Xcode-26.1.app/Contents/Developer pnpm --filter app ios
```

**Or wait for Expo.** After any Expo upgrade, this tells you in a second whether
the first failure is gone, without a full build:

```bash
grep -rn "SWIFT_RETURNS_RETAINED" \
  node_modules/.pnpm/expo-modules-jsi@*/node_modules/expo-modules-jsi/apple/
```

No matches means fix (1) has landed; run the build to find out about (2). Delete
`ios/` first so prebuild regenerates against the new version:

```bash
rm -rf apps/app/ios && pnpm --filter app ios
```

Do not patch the annotations in `node_modules` to get past it. It was tried while
diagnosing this; it only moves the failure to the Swift concurrency errors, and a
patch against a dependency's Apple sources is not something this repository
should carry.

## Running on Android

**Local builds work here**, unlike iOS: the Xcode blocker is Swift-specific and
has no Android equivalent.

```bash
pnpm --filter app android   # expo run:android — a real development build
```

First run takes about 15 minutes and Gradle installs what it needs as it goes
(NDK 27.1, build-tools 36, platform 36 — Expo SDK 57 targets API 36). It
installs `app.circles.development` on the running emulator. Later runs are
incremental; you only rebuild when native dependencies change, and reload JS
over the installed app the rest of the time.

Expo Go also works (`pnpm --filter app start`, then press `a`) with the same
caveats as on iOS.

### One-time Android SDK setup

There is no Android Studio here; the command-line SDK is enough.

```bash
brew install --cask android-commandlinetools
```

It needs a JDK — Java 21 works. Then accept the licences and install the
packages:

```bash
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
yes | sdkmanager --licenses
sdkmanager --install "platform-tools" "emulator" \
  "platforms;android-37.0" "build-tools;37.0.0" \
  "system-images;android-37.0;google_apis;arm64-v8a"
```

Create and boot an emulator (the `devices.xml` warning `avdmanager` prints is
harmless — the Pixel 7 profile is applied anyway):

```bash
avdmanager create avd --name circles_api37 --device pixel_7 \
  --package "system-images;android-37.0;google_apis;arm64-v8a"
emulator -avd circles_api37 &
adb wait-for-device
```

**Put the environment variables in your shell profile** — the Expo CLI and
Gradle both need them, and nothing sets them for you:

```bash
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export JAVA_HOME=/opt/homebrew/opt/openjdk@21
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
```

`android/`, like `ios/`, is generated by prebuild and git-ignored. Never edit it
by hand; delete it and rebuild.

## Structure

`app/` holds Expo Router routes only — thin composition, no logic. Screen logic
lives in `src/features` (S0-08), the design system in `src/components` (S0-04),
adapters in `src/platform`, typed reads in `src/data`, strings in `src/copy`,
events in `src/analytics`. Those boundaries are already enforced by
`eslint-plugin-boundaries` (architecture §7.2): `data` and `platform` never
import `features`.
