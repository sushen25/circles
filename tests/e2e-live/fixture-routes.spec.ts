// @e2e: core
import { expect, test } from './fixtures';

/**
 * A route that renders fixtures must not answer a real build (SUS-140). This
 * suite serves a production export with a backend, which is what every
 * deployed environment is; the smoke suite keeps the same routes alive for the
 * gallery. Every path here is in `app/(dev)`, and its layout sends it to the
 * front door.
 */
const FIXTURE_ONLY = [
  '/gallery',
  '/brand',
  '/components',
  '/get-the-app',
  '/get-the-app/welcome',
  '/join/continue',
  '/join/invalid',
  '/join/rejoined',
  '/circles/gate',
  '/circles/sunday-crew/quiet/waiting',
  '/circles/sunday-crew/quiet/interest',
  '/circles/sunday-crew/quiet/threshold',
  '/circles/sunday-crew/quiet/volunteer',
  '/circles/sunday-crew/quiet/opened',
  '/circles/sunday-crew/quiet/expired',
  '/j/k7qm2x/calendar',
  '/j/k7qm2x/calendar/pick',
  '/j/k7qm2x/calendar/denied',
  '/j/k7qm2x/overlay',
  '/j/k7qm2x/sent-again',
  '/p/k7qm2x/after',
  '/p/k7qm2x/nudge',
  '/settings/diagnostics',
  '/settings/push',
];

for (const path of FIXTURE_ONLY) {
  test(`${path} goes to the front door and shows no fixture`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveURL(/\/start$/);
    await expect(page.getByText(/Sunday Crew|nina@example\.com/i)).toHaveCount(0);
  });
}
