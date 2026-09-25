import { expect, test, type Page } from './fixtures';

import {
  circleOwnedBy,
  guestInvited,
  guestWhoAnswered,
  lockInFirstOption,
  planFor,
  sessionStorageKey,
  signedInAccount,
  sundayCrew,
} from './stack';

/**
 * Whose clock a time is written on (spec §5.6 and §5.7, ADR 0032): the
 * circle's, with "Times are Melbourne time." exactly when the reader's own
 * device is somewhere else. The device is the browser context's `timezoneId`,
 * so one file walks the same screens from London and from Melbourne.
 *
 * The unit tests move `TZ` under a view model. This is the one that proves the
 * sentence reaches the options, the review and both confirmed screens, and
 * that a reader at home is told nothing.
 */

const NOTE = 'Times are Melbourne time.';

/** Ticks a day, turns Evening on and sends. The editor is S1-25's; this uses it. */
async function answersIn(page: Page, code: string): Promise<void> {
  await expect(page.getByText("Times I'd actually be up for")).toBeVisible();
  await page.getByRole('group', { name: 'Days in this plan' }).getByRole('button').nth(1).click();
  await page.getByRole('checkbox', { name: /^Evening/ }).click();
  await page.getByRole('button', { name: 'Send my times' }).click();
  await expect(page).toHaveURL(new RegExp(`/j/${code}/sent$`));
  // Sent itself, as `sendEvenings` waits for: a hard navigation straight after
  // the client one, with Sent's requests in flight, crashes WebKit in CI.
  await expect(page.getByText(/Your times are in\./)).toBeVisible();
}

test.describe('an organiser whose phone is in London', () => {
  test.use({ timezoneId: 'Europe/London' });

  test('is told whose clock it is on the options, the review and the confirmed screen', async ({
    page,
  }) => {
    const maya = await signedInAccount('Maya');
    const circleId = circleOwnedBy(maya.userId, 'Sunday Crew');
    const plan = planFor(circleId, maya.userId);
    const crew = {
      circleId,
      planId: plan.id,
      planCode: plan.code,
      ownerId: maya.userId,
      secret: '',
    };
    guestWhoAnswered(crew, 'Tom');
    guestInvited(crew, 'Alex');

    await page.addInitScript({
      content: `localStorage.setItem(${JSON.stringify(sessionStorageKey())}, ${JSON.stringify(maya.stored)});`,
    });
    await page.goto(`/j/${plan.code}`);
    // The availability editor said it first (§9); the rest of the product agrees with it.
    await expect(page.getByText(NOTE)).toBeVisible();
    await answersIn(page, plan.code);

    await page.goto(`/circles/${circleId}/plan/${plan.id}/candidates`);
    await expect(page.getByText('Best attendance')).toBeVisible();
    await expect(page.getByText(NOTE)).toBeVisible();

    await page.getByRole('button', { name: /^Review / }).click();
    await expect(page.getByText('Lock it in?')).toBeVisible();
    // The review is pushed over the options, which the stack keeps mounted
    // underneath with their own note; the visible one is the top screen's.
    await expect(page.getByText(NOTE).last()).toBeVisible();

    lockInFirstOption(plan.id, maya.userId);
    await page.goto(`/circles/${circleId}/plan/${plan.id}/confirmed`);
    await expect(page.getByText('Ready to paste into the group chat')).toBeVisible();
    await expect(page.getByText(NOTE)).toBeVisible();
  });
});

test.describe('a member whose phone is in Melbourne', () => {
  test.use({ timezoneId: 'Australia/Melbourne' });

  test('reads the time with no note, whatever zone anybody else is in', async ({ page }) => {
    const crew = sundayCrew();
    guestWhoAnswered(crew, 'Tom');

    // Ren is new: joins from the plan link and answers, which runs the engine.
    await page.goto(`/p/${crew.planCode}`);
    await page.getByRole('button', { name: "I'm new here" }).click();
    await page.getByLabel('Your name').fill('Ren');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(new RegExp(`/j/${crew.planCode}$`));
    await expect(page.getByText(NOTE)).toHaveCount(0);
    await answersIn(page, crew.planCode);

    await page.goto(`/p/${crew.planCode}`);
    await expect(page.getByText(/^Tom picks one of these|picks one of these/)).toBeVisible();
    await expect(page.getByText(NOTE)).toHaveCount(0);

    lockInFirstOption(crew.planId, crew.ownerId);
    await page.goto(`/p/${crew.planCode}`);
    await expect(page).toHaveURL(new RegExp(`/p/${crew.planCode}/confirmed$`));
    await expect(page.getByText("You're going")).toBeVisible();
    await expect(page.getByText(NOTE)).toHaveCount(0);
  });
});
