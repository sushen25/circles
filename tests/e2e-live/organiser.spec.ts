import { expect, test, type Page } from '@playwright/test';

import {
  accountToSignInTo,
  circleOwnedBy,
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

test('a new organiser reaches a shareable plan link with two typed inputs and no permission asks', async ({
  page,
}) => {
  await watchForPermissionAsks(page);
  const requests: string[] = [];
  page.on('request', (request) => requests.push(`${request.url()} ${request.postData() ?? ''}`));

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

  // Straight to the plan, with no invite step in between (ADR 0026).
  await expect(page.getByText('Your first catch-up')).toBeVisible();
  expect(await typedFieldsOnScreen(page), 'nothing to type on the first plan').toBe(0);
  // A circle of one asks for three, not two: the placeholder that follows the
  // circle as people tap the link.
  await expect(page.getByText('At least 3 need to make it')).toBeVisible();
  await page.getByRole('button', { name: 'Ask the group' }).click();

  await expect(page.getByText('Ask Sunday Crew.')).toBeVisible();
  expect(typed).toBe(2);
  expect(await page.evaluate('window.permissionAsks'), 'no permission was asked for').toEqual([]);

  // In the database: a profile named and zoned, the circle it owns, and a plan
  // whose quorum is a placeholder.
  const profile = profileFor(email);
  expect(profile?.name).toBe('Maya');
  const deviceZone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  expect(profile?.zone).toBe(deviceZone);
  const [circle] = circlesOwnedBy(profile!.userId);
  expect(circle).toMatchObject({ name: 'Sunday Crew', cadence: 'monthly' });
  const [plan] = plansIn(circle!.id);
  expect(plan?.state).toBe('collecting');

  // The link in the chat is the plan's, and it has no secret in it.
  const link = await page
    .getByText(new RegExp(`/j/${plan!.code}`))
    .first()
    .innerText();
  expect(link).toMatch(new RegExp(`^http://localhost:\\d+/j/${plan!.code}$`));

  // Copy works without a share sheet (the in-app browsers).
  await page.getByRole('button', { name: 'Copy' }).click();
  await expect(page.getByText('Copied')).toBeVisible();

  // And the first session ends with the organiser's own times in.
  await page.getByRole('button', { name: 'Add my times' }).click();
  await expect(page).toHaveURL(new RegExp(`/j/${plan!.code}$`));
  await page.getByRole('group', { name: 'Days in this plan' }).getByRole('button').first().click();
  await page.getByRole('checkbox', { name: /^Evening/ }).click();
  await page.getByRole('button', { name: 'Send my times' }).click();
  await expect(page.getByText('Thanks, Maya. Your times are in.')).toBeVisible();
  // An account is already told about this plan, so the guest offer is not made.
  await expect(page.getByText('Get updates about this meetup by email')).toHaveCount(0);

  await page.getByRole('button', { name: "See how it's looking" }).click();
  // Exact: the share screen stays mounted underneath on the web stack, and its
  // preview card reads "Sunday Crew is finding a time to catch up".
  await expect(page.getByText('Finding a time', { exact: true })).toBeVisible();
  await expect(page.getByText('1 of 1 replied')).toBeVisible();
});

test('a returning organiser with a name skips Your name and lands on their own circle', async ({
  page,
}) => {
  const maya = await accountToSignInTo('Maya');
  const circleId = circleOwnedBy(maya.userId, 'Sunday Crew');

  await page.goto('/sign-in');
  await signInByCode(page, maya.email);

  // Her circle, not the circles list, which is fixtures until S1-23.
  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}$`));
  await expect(page.getByText('Sunday Crew').first()).toBeVisible();
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
