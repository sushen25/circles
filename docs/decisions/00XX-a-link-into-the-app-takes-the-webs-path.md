# ADR 00XX: A link into the app takes the web's path, through one capture rule

_Status: proposed · 26 September 2026_

## Context

Every capability the product sends rides in a URL fragment — the circle
invite's secret on `/join`, the emailed tokens on `/a`, `/e` and `/v` — because
no server ever sees a fragment (ADR 0023). On the web, `index.ts` takes it out
of the address bar before `expo-router/entry` is evaluated, because the router
copies a fragment into its state and writes it back on every navigation (S1-24).

`index.ts` is web-only by construction: it reads `window.location`. In the
installed app (S3-01a, SUS-92) a link arrives from the operating system instead
— `Linking.getInitialURL()` on a cold start, the `url` event while running —
and expo-router reads both itself and puts the fragment in its state as a `#`
param. Two questions followed: where the app should take the capability, and
whether it should get its own guards.

Checked on the Android emulator (API 37): an App Link opened with
`adb shell am start -d 'https://<host>/join#<secret>'` reaches the app with the
fragment intact. iOS delivers a universal link's full URL, fragment included,
in `NSUserActivity.webpageURL`; that could not be checked locally, because the
iOS development build does not compile under Xcode 26.2 (SUS-92's step 0).

## Decision

1. **One capture rule, two doors.** `takeInviteFragment` and
   `takeTokenFragment` hold the capability and say whether a fragment must be
   removed. The web's `captureInviteFragment` / `captureTokenFragment` and the
   app's `routeIncomingLink` (`src/data/links/incoming.ts`) both call them; there
   is no native copy of the rule.
2. **The app takes it at `app/+native-intent.ts`**, expo-router's
   `redirectSystemPath`, which runs for the initial URL and every `url` event
   *before* any navigation state exists. The router is handed the path without
   the fragment, and without the host.
3. **No native guards.** From there it is an ordinary navigation to the same
   route, so a link opened in the app meets exactly the guards a browser does —
   the session, `MembershipGate`, Continue-as, the re-entry screen.
4. **The app claims `APP_LINK_PATHS`** (`packages/config`) and nothing else on
   the host: the intent filters, the associated domain and the two well-known
   files are all tested against it, and it against the router's routes.
5. **The AASA is served by a route** (`app/.well-known/apple-app-site-association+api.ts`)
   whose body is a JSON template, because a static file with no extension is
   served as `application/octet-stream`. `assetlinks.json` stays a static file.

## Alternatives considered

- **Read `Linking` in `_layout.tsx`.** Where SUS-57 put it. By the time the root
  layout runs, the router has already parsed the initial URL into state, and a
  `url` event reaches the router's listener as well as ours; the fragment would
  be in state before we could take it out.
- **A native fork of the capture.** Two copies of a privacy rule is one copy
  that will be wrong; the web's has been corrected four times.
- **A static AASA with a host header rule.** EAS Hosting has no per-file header
  configuration we could find, and `expo serve` has none; a route is the one
  thing both serve as JSON.

## Consequences

- A capability in a link the app is opened with lives in memory only, as on the
  web; `/join` hears a second invite while open (`subscribeInvite`), because the
  app is never reloaded the way a tab is.
- The iOS half of the fragment claim is unverified until an iOS development
  build runs (EAS `development-simulator`, or a fixed Xcode toolchain).
- Until S3-01b fills `TEAMID` and `SHA256_FINGERPRINT`, neither platform
  verifies the claim: links open the browser unless sent to the app by name
  (`adb shell am start -p app.circles.development`).
