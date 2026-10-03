import { expect, test } from '@playwright/test';

import { brand } from '@circles/config';

/**
 * The marketing site at the bare host (SUS-149): it renders at desktop and
 * phone width, nothing overflows or hides behind a small target, every Start a
 * plan lands in the app, and it asks nothing of any other host.
 */
for (const [name, viewport] of [
  ['desktop', { width: 1440, height: 900 }],
  ['phone', { width: 390, height: 844 }],
] as const) {
  test.describe(`site, ${name}`, () => {
    test.use({ viewport });

    test('renders without errors, overflow, small targets or outside requests', async ({
      page,
    }) => {
      const problems: string[] = [];
      const hosts = new Set<string>();
      page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
      page.on('pageerror', (e) => problems.push(String(e)));
      page.on('request', (r) => hosts.add(new URL(r.url()).host));

      const response = await page.goto('/', { waitUntil: 'networkidle' });
      expect(response?.status()).toBe(200);
      await expect(page).toHaveTitle(`${brand.name} — ${brand.descriptor}`);
      await expect(page.getByRole('heading', { level: 1 })).toContainText('everyone');

      const { overflow, small } = (await page.evaluate(`({
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        small: [...document.querySelectorAll('a')]
          .filter((a) => {
            const r = a.getBoundingClientRect();
            return r.width > 0 && !a.classList.contains('skip') && (r.height < 43.5 || r.width < 43.5);
          })
          .map((a) => a.textContent.trim()),
      })`)) as { overflow: number; small: string[] };
      expect(overflow).toBeLessThanOrEqual(0);
      expect(small).toEqual([]);
      expect(problems).toEqual([]);
      expect([...hosts]).toEqual([new URL(page.url()).host]);
    });

    test('every Start a plan lands in the app’s first run', async ({ page }) => {
      await page.goto('/');
      const buttons = page.getByRole('link', { name: 'Start a plan' });
      expect(await buttons.count()).toBeGreaterThanOrEqual(4);
      for (const href of await buttons.evaluateAll((as) => as.map((a) => a.getAttribute('href')))) {
        expect(href).toBe('/start?via=site');
      }

      await buttons.last().click();
      await expect(page).toHaveURL(/\/start/);
      await expect(page.getByRole('heading', { name: brand.name })).toBeVisible();
    });
  });
}
