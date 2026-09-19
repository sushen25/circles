import { expect, test, type Page } from '@playwright/test';

import {
  accountToSignInTo,
  circlesOwnedBy,
  clearRateCounters,
  guestWhoAnswered,
  isParticipant,
  latestCodeFor,
  memberNamed,
  plansIn,
  profileFor,
  sundayCrew,
} from './stack';

/**
 * The first-time organiser (S1-22, spec §5.1, §6.1), and "I have an account"
 * on a plan link (ADR 0022), against the real stack: the email code comes from
 * the mail catcher, and every step ends in the database.
 */

test.beforeEach(() => {
  clearRateCounters();
});

/**
 * Counts every way a page can ask for a permission — geolocation, camera and
 * microphone, notifications, contacts, the Permissions API itself — plus any
 * `alert`/`confirm`/`prompt`. Recorded in the page, read back by the test.
 */
async function watchForPermissionAsks(page: Page): Promise<void> {
  await page.addInitScript({
    content: `
      window.permissionAsks = [];
      const note = (what) => window.permissionAsks.push(what);
      const wrap = (object, name, what) => {
        if (!object || typeof object[name] !== 'function') return;
        const original = object[name].bind(object);
        object[name] = (...args) => { note(what); return original(...args); };
      };
      wrap(navigator.geolocation, 'getCurrentPosition', 'geolocation');
      wrap(navigator.geolocation, 'watchPosition', 'geolocation');
      wrap(navigator.mediaDevices, 'getUserMedia', 'media');
      wrap(navigator.permissions, 'query', 'permissions');
      if (window.Notification) wrap(window.Notification, 'requestPermission', 'notifications');
      if (navigator.contacts) wrap(navigator.contacts, 'select', 'contacts');
    `,
  });
  page.on('dialog', (dialog) => {
    void page.evaluate(`window.permissionAsks.push('dialog:${dialog.type()}')`);
    void dialog.dismiss();
  });
}

/** Every text field on screen that a person could type into. */
async function typedFieldsOnScreen(page: Page): Promise<number> {
  return await page
    .locator('input:visible:not([readonly]), textarea:visible:not([readonly])')
    .count();
}

async function signInByCode(page: Page, email: string): Promise<void> {
  await page.getByLabel('Your email').fill(email);
  await page.getByRole('button', { name: 'Send me a code' }).click();
  await expect(page.getByText(`Sent to ${email}.`, { exact: false })).toBeVisible();
  await page.getByLabel('Code', { exact: true }).fill(await latestCodeFor(email));
  await page.getByRole('button', { name: 'Continue' }).click();
}

test('a new organiser reaches a shareable invite link with two typed inputs and no permission asks', async ({
  page,
}) => {
  await watchForPermissionAsks(page);
  const invites: string[] = [];
  page.on('request', (request) => invites.push(`${request.url()} ${request.postData() ?? ''}`));

  await page.goto('/');
  await page.getByRole('button', { name: 'Continue with email' }).click();
  const email = `${globalThis.crypto.randomUUID()}@example.test`;
  await signInByCode(page, email);

  // After the email path's address and code (spec §5.1 step 2): the two typed
  // inputs are the organiser's name and the circle's name, and nothing else.
  let typed = 0;
  await expect(page).toHaveURL(/\/name$/);
  await expect(page.getByLabel('Your name')).toBeVisible();
  expect(await typedFieldsOnScreen(page), 'Your name has one field').toBe(1);
  await page.getByLabel('Your name').fill('Maya');
  typed += 1;
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page).toHaveURL(/\/circles\/new$/);
  await expect(page.getByLabel('Circle name')).toBeVisible();
  expect(await typedFieldsOnScreen(page), 'FirstCircle has one field').toBe(1);
  await page.getByLabel('Circle name').fill('Sunday Crew');
  typed += 1;
  await page.getByRole('button', { name: 'Create Sunday Crew' }).click();

  await expect(page.getByText('Now invite Sunday Crew.')).toBeVisible();
  expect(await typedFieldsOnScreen(page), 'nothing to type on the invite').toBe(0);
  const link = await page
    .getByText(/\/join#/)
    .first()
    .innerText();
  expect(link).toMatch(/^http:\/\/localhost:\d+\/join#[A-Za-z0-9_-]{43,}$/);
  expect(typed).toBe(2);

  expect(await page.evaluate('window.permissionAsks'), 'no permission was asked for').toEqual([]);

  // In the database: a profile named and zoned, and the circle it owns.
  const profile = profileFor(email);
  expect(profile?.name).toBe('Maya');
  // The zone the browser reports, whatever it is: CI runs in UTC (review round 2).
  const deviceZone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  expect(profile?.zone).toBe(deviceZone);
  const [circle] = circlesOwnedBy(profile!.userId);
  expect(circle).toMatchObject({ name: 'Sunday Crew', cadence: 'monthly' });

  // The secret is in the link and nowhere a request carried it.
  const secret = link.split('#')[1]!;
  expect(invites.filter((line) => line.includes(secret))).toEqual([]);

  // Copy works without a share sheet (the in-app browsers).
  await page.getByRole('button', { name: 'Copy link' }).click();
  await expect(page.getByText('Copied. Paste it into your group chat.')).toBeVisible();

  // The circle filling up, then the first plan with its defaults.
  await page.getByRole('button', { name: 'Go to Sunday Crew' }).click();
  await expect(page.getByText('1 in so far · about monthly')).toBeVisible();
  await expect(
    page.getByText("You don't have to wait for everyone", { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Plan the first catch-up' }).click();
  await expect(page.getByText('At least 2 need to make it')).toBeVisible();
  await page.getByRole('button', { name: 'Ask the group' }).click();

  await expect(page.getByText('Now tell the group.')).toBeVisible();
  const [plan] = plansIn(circle!.id);
  expect(plan?.state).toBe('collecting');
  await expect(page.getByText(new RegExp(`/j/${plan!.code}`))).toBeVisible();

  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText('Finding a time')).toBeVisible();
  await expect(page.getByText('0 of 1 replied')).toBeVisible();
  expect(invites.filter((line) => line.includes(secret))).toEqual([]);
});

test('a returning organiser with a name skips Your name and goes to their circles', async ({
  page,
}) => {
  const maya = await accountToSignInTo('Maya');

  await page.goto('/sign-in');
  await signInByCode(page, maya.email);

  await expect(page).toHaveURL(/\/circles(\/new)?$/);
  await expect(page).not.toHaveURL(/\/name$/);
});

test('"I have an account" on a plan link signs in and comes back to the one-tap join', async ({
  page,
}) => {
  const crew = sundayCrew();
  guestWhoAnswered(crew, 'Tom');
  const ren = await accountToSignInTo('Ren');

  await page.goto(`/p/${crew.planCode}`);
  await expect(page.getByText('Welcome back. Which one is you?')).toBeVisible();
  await page.getByRole('button', { name: 'I have an account' }).click();

  await expect(page).toHaveURL(new RegExp(`/sign-in\\?next=(%2F|/)p(%2F|/)${crew.planCode}$`));
  await signInByCode(page, ren.email);

  await expect(page).toHaveURL(new RegExp(`/p/${crew.planCode}$`));
  const join = page.getByRole('button', { name: 'Join Sunday Crew as Ren' });
  await expect(join).toBeVisible();
  await join.click();

  await expect(page).toHaveURL(new RegExp(`/j/${crew.planCode}$`));
  const member = memberNamed(crew.circleId, 'Ren');
  expect(member?.userId, 'the account itself, not a new guest').toBe(ren.userId);
  expect(member?.anonymous).toBe(false);
  expect(isParticipant(crew.planId, ren.userId)).toBe(true);
});

test('a return path that leaves the site is ignored', async ({ page }) => {
  const ren = await accountToSignInTo('Ren');
  await page.goto('/sign-in?next=https%3A%2F%2Felsewhere.example%2Fj%2Fabcdefgh');
  await signInByCode(page, ren.email);
  await expect(page).toHaveURL(/^http:\/\/localhost:\d+\/circles/);
});
