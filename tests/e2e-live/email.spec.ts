import { expect, test, type Page } from '@playwright/test';

import {
  clearRateCounters,
  emailContactOf,
  isAnonymousUser,
  latestCodeFor,
  memberNamed,
  prefsTokenFor,
  subscriptionOf,
  sundayCrew,
  verifyTokenFor,
  type Scenario,
} from './stack';

/**
 * After an answer: the email offer, the verification link, the preferences
 * page and saving a place (spec §5.1, §5.8, S1-30). The two emailed pages are
 * opened in a **fresh browser** — no session, nothing stored — because that is
 * where an email link lands, and their tokens ride in the fragment, which no
 * request may carry (ADR 0023).
 */

test.beforeEach(() => {
  clearRateCounters();
});

/** Joins as `name`, answers the first evening (a day and Evening), and waits on Sent. */
async function answerAs(page: Page, crew: Scenario, name: string): Promise<string> {
  await page.goto(`/j/${crew.planCode}`);
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('group', { name: 'Days in this plan' }).getByRole('button').first().click();
  await page.getByRole('checkbox', { name: /^Evening/ }).click();
  await page.getByRole('button', { name: 'Send my times' }).click();
  await expect(page.getByText(`Thanks, ${name}. Your times are in.`)).toBeVisible();
  return memberNamed(crew.circleId, name)!.userId;
}

/** A unique address per run, so the per-address limits never carry over. */
const addressFor = (name: string) =>
  `${name.toLowerCase()}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.test`;

test('"Not now" is one tap and leaves no pending contact behind', async ({ page }) => {
  const crew = sundayCrew();
  const ren = await answerAs(page, crew, 'Ren');

  await page.getByRole('button', { name: 'Not now' }).click();

  await expect(page.getByText('Get updates about this meetup by email')).toHaveCount(0);
  expect(emailContactOf(ren)).toBeUndefined();
});

test('an address asked for is verified from the link, in a browser with no session', async ({
  page,
  browser,
}) => {
  const crew = sundayCrew();
  const ren = await answerAs(page, crew, 'Ren');
  const address = addressFor('ren');

  await page.getByLabel('Your email').fill(address);
  await page.getByRole('button', { name: 'Send verification email' }).click();
  await expect(page.getByText('Check your email.')).toBeVisible();
  await expect(page.getByText(`We sent a link to ${address}.`, { exact: false })).toBeVisible();
  expect(emailContactOf(ren)).toBe('pending');

  // The link, opened wherever the mail was read.
  const token = verifyTokenFor(ren);
  const elsewhere = await browser.newContext();
  const mail = await elsewhere.newPage();
  const urls: string[] = [];
  mail.on('request', (request) => urls.push(request.url()));

  await mail.goto(`/v#${token}`);
  await expect(mail.getByText("You'll hear about this meetup by email.")).toBeVisible();
  await expect(mail.getByText('Sunday Crew · Catch up')).toBeVisible();
  expect(emailContactOf(ren)).toBe('verified');
  expect(
    urls.filter((url) => url.includes(token)),
    'no request carries the token',
  ).toEqual([]);
  expect(await mail.evaluate('location.hash')).toBe('');

  // Single use: the same link again says so, neutrally.
  await mail.goto(`/v#${token}`);
  await expect(mail.getByText('This link has expired.')).toBeVisible();
  await elsewhere.close();
});

test('email preferences work with no session: stop one meetup, then remove the address', async ({
  page,
  browser,
}) => {
  const crew = sundayCrew();
  const ren = await answerAs(page, crew, 'Ren');
  await page.getByLabel('Your email').fill(addressFor('ren'));
  await page.getByRole('button', { name: 'Send verification email' }).click();
  await expect(page.getByText('Check your email.')).toBeVisible();
  // A verified address, as it would be by the time a preferences link is in an email.
  const verifyToken = verifyTokenFor(ren);
  const token = prefsTokenFor(ren);

  const elsewhere = await browser.newContext();
  const mail = await elsewhere.newPage();
  await mail.goto(`/v#${verifyToken}`);
  await expect(mail.getByText("You'll hear about this meetup by email.")).toBeVisible();

  await mail.goto(`/e#${token}`);
  const toggle = mail.getByRole('switch', { name: 'Sunday Crew · Catch up' });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  expect(subscriptionOf(ren, crew.planId)).toBe('withdrawn');

  await mail.getByRole('button', { name: 'Remove this email address entirely' }).click();
  await mail.getByRole('button', { name: 'Remove my email address' }).click();
  await expect(mail.getByText('Your email address is gone.')).toBeVisible();
  expect(emailContactOf(ren)).toBeUndefined();
  await elsewhere.close();
});

test('saving access turns the guest into an account, by email code', async ({ page }) => {
  const crew = sundayCrew();
  const ren = await answerAs(page, crew, 'Ren');
  const address = addressFor('ren');

  await page.getByRole('button', { name: 'Save access on every device' }).click();
  // Sent stays mounted under it in the web stack, with its own email field.
  await page.getByLabel('Your email').filter({ visible: true }).fill(address);
  await page.getByRole('button', { name: 'Send me a code' }).click();
  await expect(page.getByText('Enter the code we emailed')).toBeVisible();

  await page.getByLabel('Code', { exact: true }).fill(await latestCodeFor(address));
  await page.getByRole('button', { name: 'Continue' }).filter({ visible: true }).click();

  await expect(
    page.getByText(`Your place is saved. Sign in with ${address}`, { exact: false }),
  ).toBeVisible();
  expect(isAnonymousUser(ren), 'the same identity, now an account').toBe(false);
  expect(memberNamed(crew.circleId, 'Ren')?.userId).toBe(ren);
});
