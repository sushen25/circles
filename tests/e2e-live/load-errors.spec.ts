// @e2e: core
import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';
import { signedInAs } from './journeys';
import { signedInAccount, sql, sundayCrew } from './stack';

/**
 * The error screens (SUS-200): every "We couldn't load…" carries a short
 * reference and a second way out, and the sign-in screen says "You're offline"
 * only when the request never reached the server.
 *
 * Failures are made at the network, so what is walked is the real app against
 * the real stack: the read that fails is answered 400 by the browser's own
 * route, and the auth server's answer is a 500 or no answer at all.
 *
 * Set `SHOTS_DIR` to write a 390-wide screenshot of each, for the PR's notes.
 */

const REFERENCE = /^Ref [2-9A-HJ-NP-Z]{8}$/;

async function failReads(page: Page): Promise<void> {
  await page.route('**/rest/v1/**', (route) =>
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: '{"code":"42703","message":"column does not exist","details":null,"hint":null}',
    }),
  );
}

async function shoot(page: Page, name: string): Promise<void> {
  const dir = process.env['SHOTS_DIR'];
  if (dir !== undefined) await page.screenshot({ path: `${dir}/${name}.png` });
}

/** The founder finds a screen's reference in the logs: the client_error row carries it. */
function reported(reference: string, source: string): boolean {
  const rows = sql(`
    select 1 from analytics.events
    where event_name = 'client_error' and properties->>'reference' = '${reference}'
      and properties->>'source' = '${source}'
  `);
  return rows.length > 0;
}

test('a signed-in screen that cannot load has a reference, Try again and a way back', async ({
  page,
}) => {
  const maya = await signedInAccount('Maya');
  await signedInAs(page, maya.stored);
  await failReads(page);
  await page.goto('/circles');

  await expect(page.getByText("We couldn't load your circles.")).toBeVisible();
  const reference = page.getByText(REFERENCE);
  await expect(reference).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Go to the start' })).toBeVisible();
  await shoot(page, 'signed-in');

  const shown = (await reference.textContent())!.replace('Ref ', '');
  await expect.poll(() => reported(shown, 'load_failed'), { timeout: 20_000 }).toBe(true);
  // Never the address, the plan code or the key, whatever the page holds.
  expect(page.url()).not.toContain(shown);
});

test('a guest screen that cannot load says to reload and to open the link again', async ({
  page,
}) => {
  const crew = sundayCrew();
  await page.goto(`/join#${crew.secret}`);
  await page.getByRole('button', { name: 'Choose my times' }).click();
  await page.getByLabel('Your name').fill('Nina');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Which evenings could work?')).toBeVisible();

  await failReads(page);
  await page.reload();

  await expect(page.getByText(REFERENCE)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reload this page' })).toBeVisible();
  await expect(page.getByText('Still stuck? Open the link from the chat again.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back to your circles' })).toHaveCount(0);
  await shoot(page, 'guest');

  // The way out is a real one: it loads the same page again, which fails again here.
  await page.getByRole('button', { name: 'Reload this page' }).click();
  await expect(page.getByText(REFERENCE)).toBeVisible();
  const bodyText = (await page.locator('body').innerText()).replaceAll(crew.planCode, '');
  expect(bodyText).not.toContain(crew.secret);
});

test('sign-in: a 500 from the auth server is "couldn\'t send", with a reference, and keeps the address', async ({
  page,
}) => {
  await page.route('**/auth/v1/otp**', (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: '{"msg":"Error sending magic link email"}',
    }),
  );
  await page.goto('/sign-in');
  await page.getByLabel('Your email').fill('maya@example.com');
  await page.getByRole('button', { name: 'Send me a code' }).click();

  await expect(page.getByText("We couldn't send the code. Try again in a moment.")).toBeVisible();
  await expect(page.getByText(REFERENCE)).toBeVisible();
  await expect(page.getByText(/offline/i)).toHaveCount(0);
  await expect(page.getByLabel('Your email')).toHaveValue('maya@example.com');
  await shoot(page, 'sign-in');

  const shown = (await page.getByText(REFERENCE).textContent())!.replace('Ref ', '');
  await expect.poll(() => reported(shown, 'request_failed'), { timeout: 20_000 }).toBe(true);
});

test('sign-in: no answer at all is "You\'re offline", with no reference', async ({ page }) => {
  await page.route('**/auth/v1/otp**', (route) => route.abort('failed'));
  await page.goto('/sign-in');
  await page.getByLabel('Your email').fill('maya@example.com');
  await page.getByRole('button', { name: 'Send me a code' }).click();

  await expect(page.getByText("You're offline. Connect, then try again.")).toBeVisible();
  await expect(page.getByText(REFERENCE)).toHaveCount(0);
  await expect(page.getByLabel('Your email')).toHaveValue('maya@example.com');
});
