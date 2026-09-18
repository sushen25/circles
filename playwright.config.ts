import { defineConfig, devices } from '@playwright/test';

// Not 8081, which is Metro's: Playwright reuses whatever already answers on its
// port outside CI, so a `pnpm dev:web` left running — which has a backend —
// was silently tested in place of this suite's no-backend export, and the
// fixture journey failed for a reason nothing on screen explained.
const PORT = 8083;
const baseURL = `http://localhost:${PORT}`;

/**
 * Runs against the exported web build (`dist/client` + `dist/server`), not the
 * dev server, so the smoke test exercises what actually ships.
 *
 * S1 grows this into the full journey in mobile Safari/Chrome *and* the
 * WhatsApp/Messenger in-app-browser user agents (architecture §16).
 */
export default defineConfig({
  testDir: 'tests/e2e-web',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'mobile-chrome', use: { ...devices['Pixel 7'] } }],
  webServer: {
    command: `pnpm --filter app exec expo serve --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
