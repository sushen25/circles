/**
 * The one locale both e2e suites render in, on both sides of hydration.
 *
 * The server output (ADR 0001) formats dates in the Node process's ICU locale,
 * which follows `LANG`/`LC_ALL`; the browser hydrates in its own. When they
 * differ — Node under `en_AU` writes "Sept", Chromium in `en-US` writes "Sep" —
 * React reports a hydration mismatch (#418) on every screen with a date, and
 * the smoke suite's `pageerror` check fails on seven routes for a reason that
 * is the developer's shell, not the change under test (SUS-87).
 *
 * So the suite pins it: CI is `en-US` on both sides already, and this makes a
 * local run the same whatever the shell says. That keeps the gate about the
 * code. It does **not** make the product right for a visitor whose locale
 * differs from the server's: that is the app's to fix, by not rendering
 * locale-dependent text on the server, and it is written up on its own ticket
 * (S1-31's findings).
 */
export const LOCALE = 'en-US';

/** The server's side: what `expo serve` is started with. */
export const SERVER_LOCALE_ENV: Record<string, string> = {
  LANG: 'en_US.UTF-8',
  LC_ALL: 'en_US.UTF-8',
};
