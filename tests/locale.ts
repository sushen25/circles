/**
 * The locales the e2e suites render in.
 *
 * Until SUS-90 this pinned both sides of hydration to one locale, because the
 * served HTML formatted dates in the export machine's locale and a browser in
 * any other one met a hydration mismatch (#418) on every screen with a date
 * (SUS-87). That HTML is now a neutral shell on every route (ADR 0040): nothing
 * locale-dependent is rendered anywhere but on the device, so the two sides
 * cannot disagree, and the live suite proves it with a project whose browser
 * is in `OTHER_LOCALE` against a server in `LOCALE`.
 *
 * What is still pinned, and why:
 *
 * - **The browser**, in every project but that one: the specs read copy with
 *   dates in it, and "Thu 17 Sep" is how `en-US` writes it on this build.
 * - **The server**, so that the other project's server is `en-US` whatever a
 *   developer's shell says. It no longer keeps anything from failing; it keeps
 *   the proof a proof. `scripts/e2e-live-serve.mjs` sets the same two
 *   variables itself, so a server started by hand with `make dev-live` and
 *   reused by the suite is pinned too.
 */
export const LOCALE = 'en-US';

/** The fifth live project's browser: the scenario's own, a Melbourne phone. */
export const OTHER_LOCALE = 'en-AU';

/** The server's side: what `expo export` and `expo serve` are started with. */
export const SERVER_LOCALE_ENV: Record<string, string> = {
  LANG: 'en_US.UTF-8',
  LC_ALL: 'en_US.UTF-8',
};
