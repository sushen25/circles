import { expect, test, type Page, type Request } from '@playwright/test';

import {
  clearRateCounters,
  guestWhoAnswered,
  memberNamed,
  reentryTokenFor,
  responderIds,
  sql,
  sundayCrew,
} from './stack';

/**
 * The guest journey H2 lives or dies on (spec §2.1, §5.1, §6.2; S1-24).
 *
 * Tapped in a chat → answered, with no account, permission or install prompt;
 * and when the session is gone, one tap back in. Each acceptance criterion is a
 * test, and each ends by reading the database rather than trusting the screen:
 * the screen after a join is still a fixture until S1-25, so what proves the
 * join is the membership row.
 */

test.beforeEach(() => {
  clearRateCounters();
});

/** Anything that looks like a prompt for an account, a permission or an install. */
async function expectNoPrompts(page: Page, dialogs: string[]): Promise<void> {
  expect(dialogs, 'no browser dialog or permission prompt').toEqual([]);
  await expect(page.locator('input[type="email"], input[type="password"]')).toHaveCount(0);
}

test('an invite link reaches the plan with no prompts, and its secret never leaves the page', async ({
  page,
}) => {
  const crew = sundayCrew();
  const requests: Request[] = [];
  const dialogs: string[] = [];
  page.on('request', (request) => requests.push(request));
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.type());
    void dialog.dismiss();
  });

  await page.goto(`/join#${crew.secret}`);

  // Before any prompt: the circle, who shared it, who is in so far (§5.1).
  await expect(page.getByText('Sunday Crew is finding a time to catch up.')).toBeVisible();
  await expect(page.getByText(/^Maya shared this link\./)).toBeVisible();
  await expect(page.getByText('1 person is in so far')).toBeVisible();
  // The fragment is gone from the address bar as soon as it has been read.
  expect(page.url()).not.toContain('#');

  await page.getByRole('button', { name: 'Choose my times' }).click();
  await page.getByLabel('Your name').fill('Priya');
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page).toHaveURL(new RegExp(`/j/${crew.planCode}$`));
  await expectNoPrompts(page, dialogs);

  const priya = memberNamed(crew.circleId, 'Priya');
  expect(priya, 'Priya is a member of Sunday Crew').toBeDefined();
  expect(priya?.anonymous, 'as a guest, with no account').toBe(true);

  // The fragment is never sent anywhere: not in a request line, and not in a
  // body except the one call that exists to receive it.
  for (const request of requests) {
    expect(request.url(), `request line of ${request.url()}`).not.toContain(crew.secret);
    if (!request.url().endsWith('/functions/v1/redeem-invite')) {
      expect(request.postData() ?? '', `body sent to ${request.url()}`).not.toContain(crew.secret);
    }
  }
});

test('a taken name is asked for again, and the second name joins', async ({ page }) => {
  const crew = sundayCrew();

  await page.goto(`/join#${crew.secret}`);
  await page.getByRole('button', { name: 'Choose my times' }).click();
  await page.getByLabel('Your name').fill('Maya');
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(
    page.getByText(
      'Someone in Sunday Crew is already called Maya. Add something to tell you apart, like “Maya B”.',
    ),
  ).toBeVisible();

  // A different name is a different request, under a different key: sending it
  // under the first one would be an `idempotency_mismatch` and nobody could join.
  await page.getByLabel('Your name').fill('Maya B');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(new RegExp(`/j/${crew.planCode}$`));
  expect(memberNamed(crew.circleId, 'Maya B')?.anonymous).toBe(true);
});

test('with no plan asking, a new member lands on the circle, and is let in', async ({ page }) => {
  // The circle route is gated by the circle's id. A member arriving at it by
  // the real id — which is what joining navigates to — must reach circle home,
  // not the invite prompt a non-member gets.
  const crew = sundayCrew({ withPlan: false });

  await page.goto(`/join#${crew.secret}`);
  await page.getByRole('button', { name: 'Choose my times' }).click();
  await page.getByLabel('Your name').fill('Jess');
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page).toHaveURL(new RegExp(`/circles/${crew.circleId}$`));
  // Visible only: the navigator keeps the Join screen mounted, hidden, behind.
  await expect(
    page.getByText('Sunday Crew', { exact: true }).filter({ visible: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText('You need the invite link to join.').filter({ visible: true }),
  ).toHaveCount(0);
});

test('a revoked invite says so and asks nothing', async ({ page }) => {
  const crew = sundayCrew();
  sql(`update public.circle_invites set revoked_at = now() where circle_id = '${crew.circleId}'`);

  await page.goto(`/join#${crew.secret}`);

  await expect(page.getByText("This link isn't active any more.")).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose my times' })).toHaveCount(0);
});

test('with storage cleared, a plan link offers the guests by name and one tap restores the answer', async ({
  page,
}) => {
  const crew = sundayCrew();
  const tom = guestWhoAnswered(crew, 'Tom');
  expect(responderIds(crew.planId)).toEqual([tom]);

  // Every test's page is a fresh browser context — nothing in storage, which is
  // Safari after seven idle days, or the chat's in-app browser instead of the one
  // Tom joined in. Tom's session exists only in the database.
  const dialogs: string[] = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.type());
    void dialog.dismiss();
  });

  await page.goto(`/p/${crew.planCode}`);

  await expect(page.getByText('Welcome back. Which one is you?')).toBeVisible();
  const tomsRow = page.getByRole('button', { name: 'Continue as Tom' });
  await expect(tomsRow).toBeVisible();
  // Guests only: Maya has a saved place and can never be reattached to (ADR 0006).
  await expect(page.getByRole('button', { name: 'Continue as Maya' })).toHaveCount(0);

  await tomsRow.click();
  await expect(page.getByText('Welcome back. Which one is you?')).toHaveCount(0);
  await expectNoPrompts(page, dialogs);

  // The membership and its answer moved to this browser's new identity.
  const now = memberNamed(crew.circleId, 'Tom');
  expect(now?.userId).not.toBe(tom);
  expect(now?.anonymous).toBe(true);
  expect(responderIds(crew.planId)).toEqual([now?.userId]);
});

test('the emailed re-entry link restores access without the list', async ({ page }) => {
  const crew = sundayCrew();
  const tom = guestWhoAnswered(crew, 'Tom');
  const token = reentryTokenFor(crew, tom);

  // "Without the list" means it never rendered, not that it is gone by the time
  // the test looks. A flash of Continue-as on the way to the plan would pass a
  // check made afterwards.
  // A string rather than a function: this runs in the page, and the test
  // project is compiled without the DOM library.
  await page.addInitScript({
    content: `new MutationObserver(() => {
      if (document.body && document.body.innerText.includes('Which one is you?')) window.sawList = true;
    }).observe(document, { subtree: true, childList: true, characterData: true });`,
  });

  await page.goto(`/a/${token}`);
  await expect(page).toHaveURL(new RegExp(`/j/${crew.planCode}$`));
  expect(await page.evaluate('window.sawList === true')).toBe(false);

  const now = memberNamed(crew.circleId, 'Tom');
  expect(now?.userId).not.toBe(tom);
  expect(responderIds(crew.planId)).toEqual([now?.userId]);

  // Single use: the same link again, from a browser with nothing in it, is
  // expired and says so neutrally.
  await page.evaluate(() => localStorage.clear());
  await page.goto(`/a/${token}`);
  await expect(page.getByText('This link has expired.')).toBeVisible();
});
