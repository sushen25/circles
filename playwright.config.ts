import { defineConfig, devices } from '@playwright/test';

import { LOCALE, SERVER_LOCALE_ENV } from './tests/locale';

// Not 8081, which is Metro's: Playwright reuses whatever already answers on its
// port outside CI, so a `pnpm dev:web` left running — which has a backend —
// was silently tested in place of this suite's no-backend export, and the
// fixture journey failed for a reason nothing on screen explained.
// A parallel slot passes its own (`make test-smoke` does).
const PORT = Number(process.env['E2E_SMOKE_PORT'] ?? 8083);
const baseURL = `http://localhost:${PORT}`;

/**
 * Runs against the exported web build (`dist/client` + `dist/server`), not the
 * dev server, so the smoke test exercises what actually ships — with no
 * backend, on the fixtures. The journeys against the real stack, in the four
 * browsers a group chat hands a link to, are `playwright.live.config.ts`.
 *
 * The locale is pinned on both sides of hydration (`tests/locale.ts`): the
 * fixture screens render dates on the server, and a shell in another locale
 * made seven of them fail on React's hydration check (SUS-87).
 */
// Which build this suite needs, for `tests/expect-build-mode.ts` below.
process.env['EXPECTED_BUILD_MODE'] = 'smoke';
process.env['BUILD_MODE_URL'] = `${baseURL}/build-mode.json`;

export default defineConfig({
  testDir: 'tests/e2e-web',
  globalSetup: './tests/expect-build-mode.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
    locale: LOCALE,
  },
  projects: [{ name: 'mobile-chrome', use: { ...devices['Pixel 7'] } }],
  webServer: {
    command: `pnpm --filter app exec expo serve --port ${PORT}`,
    url: baseURL,
    env: SERVER_LOCALE_ENV,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
