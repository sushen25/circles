import { expect, test } from '@playwright/test';

import { color } from '@circles/tokens';

/**
 * The page's own background is the ground (SUS-234). The root view paints it
 * only inside the safe area, so on iPhone Safari whatever `html` and `body`
 * paint is what shows behind the status bar and around the bottom toolbar, and
 * before React renders. A route and the marketing page at `/` are different
 * documents, so both are held to it. The app has no dark mode, so there is no
 * second value.
 */
function rgb(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`;
}

for (const path of ['/', '/circles', '/sign-in']) {
  test(`${path}: html and body paint the ground, and the theme colour is the ground`, async ({
    page,
  }) => {
    await page.goto(path);
    const painted = await page.evaluate(() => ({
      html: getComputedStyle(document.documentElement).backgroundColor,
      body: getComputedStyle(document.body).backgroundColor,
    }));
    expect(painted).toEqual({ html: rgb(color.ground), body: rgb(color.ground) });
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', color.ground);
  });
}

test('the shell carries the ground with no script run', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(`${baseURL}/circles`);
  await expect(page.locator('body')).toHaveCSS('background-color', rgb(color.ground));
  await expect(page.locator('html')).toHaveCSS('background-color', rgb(color.ground));
  await context.close();
});
