import { expect, test } from '@playwright/test';

/**
 * `/privacy` is the privacy policy URL given to Google for the YouTube API
 * audit, so the served page has to carry the YouTube section and its three
 * links. A static route, with no backend.
 */
test('/privacy discloses the YouTube API use and links its terms', async ({ page }) => {
  await page.goto('/privacy');

  await expect(page.getByText('Our videos on YouTube', { exact: true })).toBeVisible();
  await expect(page.getByText(/uses YouTube API Services/)).toBeVisible();
  for (const url of [
    'https://www.youtube.com/t/terms',
    'https://policies.google.com/privacy',
    'https://security.google.com/settings/security/permissions',
  ]) {
    await expect(page.getByRole('link', { name: url })).toBeVisible();
  }
});
