import { expect, test } from '@playwright/test';

import { brand } from '@circles/config';

/**
 * The brand's files are served where the page, the emails and the chat apps
 * look for them (SUS-98). A missing favicon or lockup is not an error anybody
 * sees in a console: the tab shows a blank square, the email a broken image.
 */
test.describe('brand', () => {
  test('the page is titled and linked to its icons and manifest', async ({ page }) => {
    await page.goto('/start');

    await expect(page).toHaveTitle(brand.name);
    await expect(page.locator('link[rel="icon"][href="/favicon.ico"]')).toHaveCount(1);
    await expect(page.locator('link[rel="icon"][href="/favicon.svg"]')).toHaveCount(1);
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
    await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
  });

  test('the manifest names the product', async ({ request }) => {
    const response = await request.get('/manifest.webmanifest');

    expect(response.ok()).toBe(true);
    const manifest = (await response.json()) as { name: string; description: string };
    expect(manifest.name).toBe(brand.name);
    expect(manifest.description).toBe(brand.descriptor);
  });

  for (const [path, type] of [
    ['/favicon.ico', /icon/],
    ['/favicon.svg', /svg/],
    ['/apple-touch-icon.png', /png/],
    ['/icon-192.png', /png/],
    ['/icon-512.png', /png/],
    ['/icon-maskable-512.png', /png/],
    ['/og-card.png', /png/],
    ['/brand/wenna-lockup-2x.png', /png/],
    ['/brand/wenna-lockup-dark-2x.png', /png/],
  ] as const) {
    test(`serves ${path}`, async ({ request }) => {
      const response = await request.get(path);

      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toMatch(type);
    });
  }
});
