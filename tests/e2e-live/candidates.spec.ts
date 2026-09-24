import { expect, test, type Page } from './fixtures';

import {
  circleOwnedBy,
  guestInvited,
  guestWhoAnswered,
  memberNamed,
  planFor,
  sessionStorageKey,
  signedInAccount,
  sundayCrew,
  type Scenario,
} from './stack';

/**
 * The options, end to end (spec §5.6, S1-27): an answer runs the engine, the
 * set is stored, and the screens read it through RLS.
 *
 * Nothing else proves that chain. The unit tests render `view.ts` against rows
 * a fixture made up; the integration test reads real rows and draws nothing.
 * This walks the product — two people answer, one does not, and the organiser
 * gets an option with a name against the absence.
 */

/** Ticks a day, turns Evening on and sends. The editor is S1-25's; this uses it. */
async function answersIn(page: Page, code: string, day = 1): Promise<void> {
  await expect(page.getByText("Times I'd actually be up for")).toBeVisible();
  await page.getByRole('group', { name: 'Days in this plan' }).getByRole('button').nth(day).click();
  await page.getByRole('checkbox', { name: /^Evening/ }).click();
  await page.getByRole('button', { name: 'Send my times' }).click();
  await expect(page).toHaveURL(new RegExp(`/j/${code}/sent$`));
}

test('the organiser gets options that say who is in, who is not, and why', async ({ page }) => {
  const maya = await signedInAccount('Maya');
  const circleId = circleOwnedBy(maya.userId, 'Sunday Crew');
  const plan = planFor(circleId, maya.userId);
  const crew: Scenario = {
    circleId,
    planId: plan.id,
    planCode: plan.code,
    ownerId: maya.userId,
    secret: '',
  };
  // Tom is easy either way; Alex is asked and has not answered.
  guestWhoAnswered(crew, 'Tom');
  guestInvited(crew, 'Alex');

  await page.addInitScript({
    content: `localStorage.setItem(${JSON.stringify(sessionStorageKey())}, ${JSON.stringify(maya.stored)});`,
  });
  await page.goto(`/j/${plan.code}`);
  await answersIn(page, plan.code);

  await page.goto(`/circles/${circleId}/plan/${plan.id}/candidates`);

  await expect(page.getByText(/looks good for two of you\./)).toBeVisible();
  await expect(page.getByText('Best attendance')).toBeVisible();
  await expect(page.getByText('2 of 3').first()).toBeVisible();
  await expect(page.getByText('2 of 3 replied')).toBeVisible();
  // The manifesto's test (§3.4): the absence has a name and a reason.
  await expect(page.getByText("Alex hasn't answered").first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nudge Alex' })).toBeVisible();

  const review = page.getByRole('button', { name: /^Review / });
  await expect(review).toBeVisible();
  await review.click();
  // The candidate travels as its start instant, which `confirm-meetup` takes.
  await expect(page).toHaveURL(/candidate=\d{4}-\d{2}-\d{2}T/);
});

test('a member who has answered sees the same options, with nothing to confirm', async ({
  page,
}) => {
  const crew = sundayCrew();
  guestWhoAnswered(crew, 'Tom');

  // Tom is a guest, so the link offers his row first (ADR 0006); Ren is new.
  await page.goto(`/p/${crew.planCode}`);
  await page.getByRole('button', { name: "I'm new here" }).click();
  await page.getByLabel('Your name').fill('Ren');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(new RegExp(`/j/${crew.planCode}$`));
  await answersIn(page, crew.planCode);

  await page.goto(`/p/${crew.planCode}`);
  await expect(page.getByText(/looks good for/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Change my times' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Review / })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Nudge/ })).toHaveCount(0);
  expect(memberNamed(crew.circleId, 'Ren')).toBeDefined();
});
