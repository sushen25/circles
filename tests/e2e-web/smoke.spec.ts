import { expect, test } from '@playwright/test';

import { brand } from '@circles/config';

test.describe('web build', () => {
  test('serves the placeholder screen', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: brand.name })).toBeVisible();
  });

  test('serves the not-found route', async ({ page }) => {
    const response = await page.goto('/does-not-exist');

    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading')).toBeVisible();
  });
});
