import { expect, test } from '@playwright/test';

import { brand } from '@circles/config';

/**
 * "Something off? Tell me" (SUS-170): on Sent, both Confirmed screens and
 * circle home, in view without scrolling at 390 wide and at 200% type, and
 * nowhere on join or the availability editor (spec §5.11).
 *
 * 200% is the browser's own text zoom: the page at twice the scale, which is
 * the same layout as a viewport half as wide (as `a11y.spec.ts` does).
 */
const PLACEMENTS = [
  { name: 'Sent', path: '/j/abc/sent', above: [] as string[] },
  { name: 'Confirmed, guest', path: '/p/abc/confirmed', above: ['Add to calendar'] },
  {
    name: 'Confirmed, organiser',
    path: '/circles/sunday-crew/plan/thu-17/confirmed',
    above: ['Share to group chat', 'Add to my calendar'],
  },
  { name: 'circle home', path: '/circles/sunday-crew', above: ['Plan a catch-up'] },
];
const SIZES = [
  { label: '390 wide', width: 390, height: 844 },
  { label: '200% type', width: 195, height: 422 },
];

const LINK = 'Something off? Tell me';
const FALLBACK = `No mail app? Write to ${brand.supportEmail}`;

test.describe('the feedback link', () => {
  for (const size of SIZES) {
    for (const place of PLACEMENTS) {
      test(`${place.name} shows it in view at ${size.label}`, async ({ page }) => {
        await page.setViewportSize({ width: size.width, height: size.height });
        await page.goto(place.path);

        const link = page.getByRole('button', { name: LINK });
        await expect(link).toBeVisible();
        const box = (await link.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(size.width);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.y + box.height).toBeLessThanOrEqual(size.height);

        // Below the primary actions: each of the footer's own sits above it (Sent's
        // are in its body, which scrolls under the footer).
        for (const name of place.above) {
          const primary = (await page.getByRole('button', { name }).boundingBox())!;
          expect(primary.y + primary.height, name).toBeLessThanOrEqual(box.y);
        }

        // Nothing says the address before the tap; after it, the line and the
        // way to copy it fit the same footer, and the link has not moved off.
        await expect(page.getByText(FALLBACK)).toHaveCount(0);
        await link.click();
        for (const shown of [
          page.getByText(FALLBACK),
          page.getByRole('button', { name: 'Copy address' }),
          link,
        ]) {
          await expect(shown).toBeVisible();
          const at = (await shown.boundingBox())!;
          expect(at.x).toBeGreaterThanOrEqual(0);
          expect(at.x + at.width).toBeLessThanOrEqual(size.width);
          expect(at.y).toBeGreaterThanOrEqual(0);
          expect(at.y + at.height).toBeLessThanOrEqual(size.height);
        }
      });
    }
  }

  test('is not on join or the availability editor', async ({ page }) => {
    for (const path of ['/join', '/j/abc']) {
      await page.goto(path);
      await expect(page.getByRole('button').first()).toBeVisible();
      await expect(page.getByRole('button', { name: LINK })).toHaveCount(0);
    }
  });
});
