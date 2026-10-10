import { defineConfig, devices } from '@playwright/test';

import { LOCALE, OTHER_LOCALE, SERVER_LOCALE_ENV } from './tests/locale';
import { specsFor } from './tests/e2e-live/scopes';

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
 * Five projects, two engines. **Every spec runs in the first two.** The other
 * three run only the specs that say they depend on what those projects differ
 * on (`// @e2e:` on a spec's first lines; `tests/e2e-live/scopes.ts` says how,
 * and `pnpm check:workflows` fails a spec that does not say). Until SUS-179 all
 * five ran everything they could, and the live step went from 11.1 to 15.6
 * minutes of CI's 27 in nine days.
 *
 * - **android-chrome** — Chromium, as Chrome on Android. The one project the
 *   once-only tests run in (`test.skip(project !== 'android-chrome')`).
 * - **iphone-safari** — WebKit, as mobile Safari. It is also what WhatsApp opens
 *   a link in on iOS (SFSafariViewController), which sends Safari's own user
 *   agent, so a separate "whatsapp-ios" project would be this one twice.
 *
 * The next two run the `in-app-browser` specs, where the user agent is the
 * point:
 *
 * - **whatsapp-android** — Chromium with an Android WebView user agent (`; wv`).
 *   Neither in-app browser says "WhatsApp": only WhatsApp's *preview fetcher*
 *   does, and `+middleware.ts` serves that the link card rather than the page —
 *   `link-preview.spec.ts` pins both halves of that.
 * - **messenger-ios** — WebKit, because Messenger's in-app browser on iOS is a
 *   WKWebView, with the `FBAN`/`FBAV` tokens it adds. Until S1-31 this ran on
 *   Chromium because CI had no WebKit.
 *
 * The last runs the `locale` specs:
 *
 * - **iphone-safari-en-au** — mobile Safari in `en-AU`, against a server in
 *   `en-US` (`tests/locale.ts`). The served HTML is a shell with nothing
 *   locale-dependent in it (ADR 0040), so a browser in another locale than the
 *   export's hydrates cleanly; `fixtures.ts` fails any test whose page reports
 *   a hydration error, and this project is where a date rendered into the
 *   server's *text* would be caught (SUS-90). React's production build reports
 *   text mismatches only: one in an attribute, an `aria-label` say, would pass.
 *   The served HTML is the same shell on every route, so what this project
 *   proves is about the server and the browser disagreeing, not about any one
 *   journey; the specs it takes are every way a link from a chat lands (plan
 *   link, invite, name step) and the screens that write dates.
 *
 * CI runs this suite as two shards on two runners (`.github/workflows/check.yml`,
 * `--shard=1/2` and `2/2`); the measured times are in `docs/runbooks/ci.md`.
 * Locally it is one run, about as long as the whole of the old one.
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
  // minutes locally, against 3.1 at two.
  fullyParallel: false,
  workers: 2,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // A stack that has stopped answering (an Edge runtime that died: every test
  // then waits out its timeouts) fails all of a shard's tests one by one and
  // used to take the job's whole 15 minutes to say so. Twenty failures is not
  // flakiness. Only a red run ends early; a green one runs every test.
  maxFailures: process.env.CI ? 20 : 0,
  // In CI: annotations on the pull request, the HTML report and the traces
  // (uploaded when a job fails, SUS-143) and a JSON file the job summary is
  // written from (`scripts/live-summary.mjs`, SUS-179). The report is in a
  // folder of its own because the smoke suite writes one too.
  reporter: process.env.CI
    ? [
        ['github'],
        ['html', { open: 'never', outputFolder: 'playwright-report/live' }],
        ['json', { outputFile: 'playwright-report/live-results.json' }],
      ]
    : 'list',
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
      testMatch: specsFor('in-app-browser'),
      use: {
        ...devices['Pixel 7'],
        userAgent:
          'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UQ1A.240105.004; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.179 Mobile Safari/537.36',
      },
    },
    {
      name: 'messenger-ios',
      testMatch: specsFor('in-app-browser'),
      use: {
        ...devices['iPhone 14'],
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/MessengerForiOS;FBAV/458.0.0.43.109;FBBV/612345678;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/17.5;FBSS/3;FBCR/;FBID/phone;FBLC/en_GB;FBOP/5]',
      },
    },
    {
      name: 'iphone-safari-en-au',
      testMatch: specsFor('locale'),
      use: { ...devices['iPhone 14'], locale: OTHER_LOCALE },
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
