import { defineConfig, devices } from '@playwright/test';

import { LOCALE, SERVER_LOCALE_ENV } from './tests/locale';

// 8082 in the primary checkout. A parallel slot passes its own
// (`make test-live` does) so a hand run never lands on another slot's server.
const PORT = Number(process.env['E2E_LIVE_PORT'] ?? 8082);
const baseURL = `http://localhost:${PORT}`;

/**
 * The web product against the real stack, in the browsers a group chat hands a
 * link to (S1-24, S1-31; spec §10, architecture §16).
 *
 * `playwright.config.ts` exports with no backend and walks the fixtures; this
 * exports **with** the local stack's URL and publishable key and walks what
 * people actually meet — the first run, a guest's answer, the way back in, the
 * emailed links, the organiser's loop — through the Edge Functions and RLS.
 *
 * Four projects, two engines, and the user agent is the point of each:
 *
 * - **iphone-safari** — WebKit, as mobile Safari. It is also what WhatsApp opens
 *   a link in on iOS (SFSafariViewController), which sends Safari's own user
 *   agent, so a separate "whatsapp-ios" project would be this one twice.
 * - **android-chrome** — Chromium, as Chrome on Android.
 * - **whatsapp-android** — Chromium with an Android WebView user agent (`; wv`).
 *   Neither in-app browser says "WhatsApp": only WhatsApp's *preview fetcher*
 *   does, and `+middleware.ts` serves that the link card rather than the page —
 *   `link-preview.spec.ts` pins both halves of that.
 * - **messenger-ios** — WebKit, because Messenger's in-app browser on iOS is a
 *   WKWebView, with the `FBAN`/`FBAV` tokens it adds. Until S1-31 this ran on
 *   Chromium because CI had no WebKit.
 *
 * The locale is pinned on both sides (`tests/locale.ts`), because the server
 * render and the browser each format dates in their own and React reports a
 * hydration mismatch when they differ (SUS-87's finding, S1-31's decision).
 */
// Which build this suite needs, for `tests/expect-build-mode.ts` below.
process.env['EXPECTED_BUILD_MODE'] = 'live';
process.env['BUILD_MODE_URL'] = `${baseURL}/build-mode.json`;

export default defineConfig({
  testDir: 'tests/e2e-live',
  globalSetup: './tests/expect-build-mode.ts',
  // Two workers, each taking whole files. Every test makes its own circle,
  // plan and people, so two at once never share a row; what they do share is
  // the per-address rate counters (every local request comes from one
  // address), which each test clears as it starts, and the dispatcher's lease,
  // which `runDispatcher` waits for. At one worker the four projects took 5.3
  // minutes locally, against 3.1 at two; S1-31's budget for CI is ten.
  fullyParallel: false,
  workers: 2,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 60_000,
  // Every step here is a round trip through an Edge Function, and WebKit on a
  // CI runner is the slowest of the four; five seconds was Chromium's margin.
  expect: { timeout: 10_000 },
  use: { baseURL, trace: 'on-first-retry', locale: LOCALE },
  projects: [
    { name: 'iphone-safari', use: { ...devices['iPhone 14'] } },
    { name: 'android-chrome', use: { ...devices['Pixel 7'] } },
    {
      name: 'whatsapp-android',
      use: {
        ...devices['Pixel 7'],
        userAgent:
          'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UQ1A.240105.004; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.179 Mobile Safari/537.36',
      },
    },
    {
      name: 'messenger-ios',
      use: {
        ...devices['iPhone 14'],
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/MessengerForiOS;FBAV/458.0.0.43.109;FBBV/612345678;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/17.5;FBSS/3;FBCR/;FBID/phone;FBLC/en_GB;FBOP/5]',
      },
    },
  ],
  webServer: {
    command: `node scripts/e2e-live-serve.mjs ${PORT}`,
    url: baseURL,
    env: SERVER_LOCALE_ENV,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
  },
});
