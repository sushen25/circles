# ADR 0040: The served HTML is a neutral shell; every screen renders on the device

_Status: proposed · 25 September 2026_

## Context

ADR 0001 chose Expo Router's `server` output so that one API route could serve
link previews. It said nothing about the pages, and the architecture's stack
table said "everything else is client-rendered". That was not true. `server`
output **pre-renders every page once, at export**, and `expo serve` (and EAS
Hosting) hand that HTML to every visitor before React hydrates it in the
browser. The HTML for `/p/[code]` is rendered with the literal parameter
`[code]`, no URL fragment, no session, no storage, and the export machine's
locale, zone and clock.

Everything a screen rendered there was a guess about a visitor it could not
see, and S1-31 (SUS-47) found three ways the guess was wrong (SUS-90):

1. **Refusals nobody earned.** `[code]` is not a short code, so the membership
   gate rendered "You need the invite link to join" into `/p/[code].html` and
   every page under `/p` and `/j`. Every guest who tapped a plan link in a
   chat read it until the scripts arrived, on the product's front door.
   `/join/name` served "Open the invite link again", and `/a`, `/e` and `/v`
   served "This link has expired" to people whose link was fine.
2. **Dates in the export's locale.** Screens that render from fixtures or from
   the clock formatted dates in the export machine's ICU locale. A browser in
   another locale wrote them differently, and React reported a hydration
   mismatch (#418) and re-rendered (SUS-87).
3. **Typing thrown away.** `/sign-in` served its email field in the HTML. What
   a person typed into it before React took over was not in React's state,
   so Send said the field was empty while it visibly was not.

React recovers from a mismatch by rendering again on the client, so the screen
ended up right, after a flash of the wrong one and an error in the console.
The e2e suites hid all three: they pinned one locale on both sides and waited
for hydration after every `goto`.

Spec §10 asks for "locale-aware formatting", and manifesto §6 for no
hard-coded clock or date order: dates are written as the device writes them.
The export machine is not the device, and cannot be: one HTML file answers
every visitor.

## Decision

**Until React has hydrated, the root layout renders a neutral shell instead of
the route, on every route. The route renders only on the device.**

- `useHydrated()` (`src/platform/hydration.ts`) is `useSyncExternalStore` with
  a server snapshot of `false` and a client snapshot of `true`. React reads the
  server snapshot while hydrating, so the first client render matches the HTML
  exactly, and then re-renders with `true` by itself. Native has no hydration
  and reads `true` from its first render, so native never shows the shell.
- `ShellScreen` (`src/features/system`) is the shell: the ground, an empty top
  bar and "Getting things ready", built like every route's own loading state,
  so the step to that state is a change of words and not of layout. It says
  nothing that could be wrong for somebody: no refusal, no date, no name, no
  field.
- The document around it is unchanged: the `<head>`, the title and the styles
  are still served, and the link-preview middleware is untouched.

What this settles for each of the three:

1. **Gates.** No gate renders on the server at all, so no refusal can be in the
   HTML. A gate's own loading state, and then its answer, come from the device
   once it has read its session.
2. **Locale.** Anything locale-, zone- or clock-dependent renders only on the
   device, in the device's own locale (spec §10, manifesto §6). No formatter needs
   a fixed locale or a second pass, and a new `Intl` call in a screen cannot
   bring the mismatch back.
3. **Input.** No field exists until React has rendered it, so there is nothing
   to type into before React owns it. Nothing needs to read the DOM back or
   disable a field until hydration.

## Alternatives considered

- **Fix each defect where it is** (the ticket's suggested shape). Gates render
  their loading state until hydrated; formatters take a fixed locale on the
  server with a matching first client render, or render on the client only;
  fields are disabled until hydrated, or read back from the DOM. It keeps
  pre-rendered content for the pages that could have it (privacy, terms), but
  it is a rule every screen has to remember: there are about twenty `Intl`
  call sites across five features and the shared components, two of them
  reading the device's zone, and every new field and every new gate is
  another place to forget. The next one to
  forget ships a #418 the tests might not reach.
- **A fixed locale on the server with a matching first client render.** Stops
  the mismatch, then shows every visitor outside that locale their dates
  twice, the second time differently. It also does nothing for the zone, the
  clock or the session.
- **`web.output: "single"`.** A single-page build has no pre-render at all, but
  it cannot serve the API route or the middleware ADR 0001 exists for.
- **Opting routes out one at a time** (a per-route client-only wrapper). The
  same as the first, with the rule moved from formatters to routes; a route
  added without it is back to guessing.

## Consequences

- Every route's served HTML is the same shell, whatever the route. First paint
  on a slow phone is "Getting things ready" rather than the wrong screen, then
  the route's own loading state, then the screen. The link-preview card is
  unaffected: the middleware answers preview fetchers before the page is read.
- Pages with nothing visitor-dependent in them (privacy, terms, not-found) no
  longer have their text in the HTML. Nothing reads it: the app needs scripts
  to do anything, search engines are not a goal for the MVP, and chat previews
  come from the middleware. A route that one day wants its text pre-rendered
  for its own sake makes that case in an ADR of its own.
- Screens may use the device's locale, zone, clock and storage in render
  without thinking about the server. `JoinFlow`'s own server snapshot for the
  held invite is now belt and braces and stays.
- The live e2e suite proves it rather than hiding it: `fixtures.ts` fails any
  test whose page reports a React hydration error, it no longer waits for
  hydration after `goto`, and a fifth project, `iphone-safari-en-au`, runs the
  journeys a chat link lands on and the screens that write dates in `en-AU`
  against an `en-US` export (a subset, for the CI budget: the shell is the same
  on every route, so the proof does not need every journey). `served-html.spec.ts` asks the
  server for the gated routes and every route with a field and requires the
  shell, and types into the name and email fields the moment they can be typed
  into, with the scripts held back.
- The shell's copy is one key, `shell.loading`. It is the only text the served
  HTML ever contains, and it must stay true for every visitor to every route.
