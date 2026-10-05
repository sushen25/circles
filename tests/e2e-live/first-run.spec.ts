import { expect, test, type Page } from './fixtures';

import { signedInAs } from './journeys';
import {
  accountToSignInTo,
  circleOwnedBy,
  circlesOwnedBy,
  durationOf,
  guestWhoAnswered,
  isParticipant,
  latestCodeFor,
  memberNamed,
  plansIn,
  planFor,
  profileFor,
  quorumOf,
  sql,
  signedInAccount,
  sundayCrew,
} from './stack';

/**
 * The first run (S1-22, S1-22b, SUS-150; spec §5.1, §6.1): first circle → first
 * plan → Save your place (email → code) → name → the plan's share screen → the
 * organiser's own times → circle home. Nothing is created until the place is
 * saved (ADR 0053). Then the ways a returning organiser comes in, and
 * "I have an account" on a plan link (ADR 0022). Against the real stack: the
 * email code comes from the mail catcher, and every step ends in the database.
 */

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

/** How many circles with this name exist at all: the abandoned draft's witness. */
function circleCountNamed(name: string): number {
  return Number(sql(`select count(*) from circles where name = '${name}'`)[0]?.[0] ?? 0);
}

async function draftThroughThePlan(page: Page, circleName: string): Promise<void> {
  await page.goto('/start');
  await page.getByLabel('Circle name').fill(circleName);
  await page.getByRole('button', { name: `Create ${circleName}` }).click();
  await expect(page.getByText('Your first catch-up')).toBeVisible();
  await page.getByRole('button', { name: 'Ask the group' }).click();
  await expect(page.getByText("Your plan's ready. Save your place.")).toBeVisible();
}

async function signInByCode(page: Page, email: string): Promise<void> {
  await page.getByLabel('Your email').fill(email);
  await page.getByRole('button', { name: 'Send me a code' }).click();
  await expect(page.getByText(`Sent to ${email}.`, { exact: false })).toBeVisible();
  const code = page.getByLabel('Code', { exact: true });
  // One field under the six boxes, marked so that iOS offers the code from
  // Mail above the keyboard and Android from its SMS/email autofill — the
  // reason the field is built that way (S1-22). Nothing here can tap the
  // suggestion; this pins what makes it appear.
  await expect(code).toHaveAttribute('autocomplete', 'one-time-code');
  await expect(code).toHaveAttribute('inputmode', 'numeric');
  await code.fill(await latestCodeFor(email));
  await page.getByRole('button', { name: 'Continue' }).click();
}

test('a new organiser reaches a shareable plan link with two typed inputs and no permission asks', async ({
  page,
}) => {
  await watchForPermissionAsks(page);
  const requests: string[] = [];
  page.on('request', (request) => requests.push(`${request.url()} ${request.postData() ?? ''}`));

  await page.goto('/start');
  const email = `${globalThis.crypto.randomUUID()}@example.test`;

  // The first screen is the circle, with no sign-in before it (ADR 0053). The
  // two typed inputs are the circle's name and, after the gate, the organiser's.
  let typed = 0;
  await expect(page.getByLabel('Circle name')).toBeVisible();
  expect(await typedFieldsOnScreen(page), 'FirstCircle has one field').toBe(1);
  await page.getByLabel('Circle name').fill('Sunday Crew');
  typed += 1;
  await page.getByRole('button', { name: 'Create Sunday Crew' }).click();

  // The plan, drafted: a circle of one, so the quorum is words and not a number.
  await expect(page.getByText('Your first catch-up')).toBeVisible();
  expect(await typedFieldsOnScreen(page), 'nothing to type on the first plan').toBe(0);
  await expect(page.getByText('Most of the group need to make it')).toBeVisible();

  // Anything on the card can be changed with no account: the full setup, over the
  // draft. Three hours instead of two, saved on the device and sent nowhere.
  await expect(page.getByText('About 2 hours')).toBeVisible();
  await page.getByRole('button', { name: 'Change' }).first().click();
  await expect(page).toHaveURL(/\/circles\/new\/plan\/setup$/);
  await expect(page.getByRole('button', { name: 'Save plan' })).toBeVisible();
  await page.getByRole('checkbox', { name: '3 hrs' }).click();
  await page.getByRole('button', { name: 'Save plan' }).click();
  await expect(page.getByText('About 3 hours')).toBeVisible();
  // It survives a reload.
  await page.reload();
  await expect(page.getByText('About 3 hours')).toBeVisible();
  await page.getByRole('button', { name: 'Ask the group' }).click();

  // The gate is the third screen, after the plan, and nothing exists yet.
  await expect(page.getByText("Your plan's ready. Save your place.")).toBeVisible();
  expect(
    requests.filter((request) => /create-circle|create-plan/.test(request)),
    'nothing is sent to be made before the place is saved',
  ).toEqual([]);
  await signInByCode(page, email);

  await expect(page).toHaveURL(/\/name$/);
  await expect(page.getByLabel('Your name')).toBeVisible();
  expect(await typedFieldsOnScreen(page), 'Your name has one field').toBe(1);
  await page.getByLabel('Your name').fill('Maya');
  typed += 1;
  await page.getByRole('button', { name: 'Continue' }).click();

  // Straight to the share screen: the circle and the plan are made on the way.
  await expect(page.getByText('Ask Sunday Crew.')).toBeVisible();
  expect(typed).toBe(2);
  expect(await page.evaluate('window.permissionAsks'), 'no permission was asked for').toEqual([]);
  // A circle of one asks for three: the placeholder that follows the circle as
  // people tap the link (ADR 0026, unchanged).
  const draftedPlan = plansIn(circlesOwnedBy(profileFor(email)!.userId)[0]!.id)[0];
  expect(quorumOf(draftedPlan!.id)).toEqual({ quorum: 3, source: 'defaulted' });
  // And the plan made after the gate is the one that was changed before it.
  expect(durationOf(draftedPlan!.id)).toBe(180);

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

test('a returning organiser with a name skips Your name and lands on their circles', async ({
  page,
}) => {
  const maya = await accountToSignInTo('Maya');
  const circleId = circleOwnedBy(maya.userId, 'Sunday Crew');

  await page.goto('/sign-in');
  await signInByCode(page, maya.email);

  // Her circles, live since S1-23, and her circle among them by its real id.
  await expect(page).toHaveURL(/\/circles$/);
  await expect(page.getByText('Your circles')).toBeVisible();
  await page.getByRole('button', { name: /^Sunday Crew\./ }).click();
  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}$`));
  // The heading, not the text: the list stays mounted underneath on the web stack.
  await expect(page.getByRole('heading', { name: 'Sunday Crew' })).toBeVisible();
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

test('where the browser has a share sheet, "Share to group chat" hands it the plan link', async ({
  page,
}) => {
  // Mobile Safari and Chrome have `navigator.share`; the in-app browsers and
  // Playwright's own builds mostly do not, so the copy path is what the first
  // run above takes. This is the other half: the sheet, given the message.
  await page.addInitScript({
    content: `
      window.shared = [];
      navigator.share = (data) => { window.shared.push(data); return Promise.resolve(); };
      navigator.canShare = () => true;
    `,
  });
  const maya = await signedInAccount('Maya');
  const circleId = circleOwnedBy(maya.userId, 'Sunday Crew');
  const plan = planFor(circleId, maya.userId);
  await signedInAs(page, maya.stored);

  await page.goto(`/circles/${circleId}/plan/${plan.id}/shared`);
  await page.getByRole('button', { name: 'Share to group chat' }).click();

  await expect
    .poll(() => page.evaluate('window.shared.map((d) => d.text).join("\\n")'))
    .toMatch(new RegExp(`/j/${plan.code}\\b`));
  await expect(page.getByText('Copied', { exact: true })).toHaveCount(0);
});

test('abandoning at the gate creates nothing, and a reload keeps the draft', async ({ page }) => {
  const name = `Abandon ${globalThis.crypto.randomUUID().slice(0, 8)}`;
  await draftThroughThePlan(page, name);

  // A reload on the gate: the draft is still there, and so is the screen.
  await page.reload();
  await expect(page.getByText("Your plan's ready. Save your place.")).toBeVisible();
  // Back at the front door the name is still typed.
  await page.goto('/start');
  await expect(page.getByLabel('Circle name')).toHaveValue(name);

  expect(circleCountNamed(name), 'no circle after walking away').toBe(0);
});

test('a draft older than 24 hours is gone', async ({ page }) => {
  await draftThroughThePlan(page, 'Stale Crew');
  await page.evaluate(() => {
    const key = 'circles.organiser-draft';
    const draft = JSON.parse(globalThis.localStorage.getItem(key) ?? '{}');
    draft.updatedAt = Date.now() - 24 * 60 * 60 * 1000 - 1000;
    globalThis.localStorage.setItem(key, JSON.stringify(draft));
  });

  await page.goto('/start');
  await expect(page.getByLabel('Circle name')).toHaveValue('');
  expect(
    await page.evaluate(() => globalThis.localStorage.getItem('circles.organiser-draft')),
  ).toBe(null);
});

test('the draft survives the email code, and the circle is made only after it', async ({
  page,
}) => {
  const name = `Coded ${globalThis.crypto.randomUUID().slice(0, 8)}`;
  const email = `${globalThis.crypto.randomUUID()}@example.test`;
  await draftThroughThePlan(page, name);

  await page.getByLabel('Your email').fill(email);
  await page.getByRole('button', { name: 'Send me a code' }).click();
  await expect(page.getByLabel('Code', { exact: true })).toBeVisible();
  expect(circleCountNamed(name), 'a code was asked for, still nothing made').toBe(0);

  // Reload in the middle of the round trip: the gate asks again, the draft holds.
  // A second address, because the auth server holds a second code for the first
  // back for a minute.
  await page.reload();
  await expect(page.getByText("Your plan's ready. Save your place.")).toBeVisible();
  const second = `${globalThis.crypto.randomUUID()}@example.test`;
  await signInByCode(page, second);
  await page.getByLabel('Your name').fill('Maya');
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByText(`Ask ${name}.`)).toBeVisible();
  expect(circleCountNamed(name)).toBe(1);
});

test('a signed-in organiser goes circle, plan, share with no gate', async ({ page }) => {
  const maya = await accountToSignInTo('Maya');
  await page.goto('/sign-in');
  await signInByCode(page, maya.email);
  await expect(page).toHaveURL(/\/circles(\/new)?$/);

  const name = `Again ${globalThis.crypto.randomUUID().slice(0, 8)}`;
  await page.goto('/circles/new');
  await page.getByLabel('Circle name').fill(name);
  await page.getByRole('button', { name: `Create ${name}` }).click();
  await page.getByRole('button', { name: 'Ask the group' }).click();

  await expect(page.getByText(`Ask ${name}.`)).toBeVisible();
  await expect(page.getByText('Save your place')).toHaveCount(0);
  expect(circleCountNamed(name)).toBe(1);
});
