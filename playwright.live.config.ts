import { defineConfig, devices } from '@playwright/test';

const PORT = 8082;
const baseURL = `http://localhost:${PORT}`;

/**
 * The guest join journey against the real stack (S1-24).
 *
 * `playwright.config.ts` exports with no backend and walks the fixtures; this
 * exports **with** the local stack's URL and publishable key and walks what a
 * guest actually meets — Join, Name, Continue-as, the emailed re-entry link —
 * through `redeem-invite`, `reattach-member` and RLS.
 *
 * The user agents are the point (spec §10: "the in-app browsers of WhatsApp and
 * Messenger are first-class test targets for every guest route"). Neither
 * in-app browser names WhatsApp in its user agent — WhatsApp hands links to
 * Chrome Custom Tabs on Android and to SFSafariViewController on iOS, and it is
 * only WhatsApp's *preview fetcher* that says "WhatsApp". So the WhatsApp
 * project is an Android WebView UA, and Messenger's carries the `FBAN`/`FBAV`
 * tokens Facebook's own browser sends. All three run on Chromium; mobile Safari
 * needs WebKit, which CI does not install today, and is on S1-31 with the rest
 * of the user-agent matrix.
 */
// Which build this suite needs, for `tests/expect-build-mode.ts` below.
process.env['EXPECTED_BUILD_MODE'] = 'live';
process.env['BUILD_MODE_URL'] = `${baseURL}/build-mode.json`;

export default defineConfig({
  testDir: 'tests/e2e-live',
  globalSetup: './tests/expect-build-mode.ts',
  // One stack, one set of per-address rate counters: parallel workers would be
  // measuring each other.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 60_000,
  use: { baseURL, trace: 'on-first-retry' },
  projects: [
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
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
        browserName: 'chromium',
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/MessengerForiOS;FBAV/458.0.0.43.109;FBBV/612345678;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/17.5;FBSS/3;FBCR/;FBID/phone;FBLC/en_GB;FBOP/5]',
      },
    },
  ],
  webServer: {
    command: `node scripts/e2e-live-serve.mjs ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
  },
});
