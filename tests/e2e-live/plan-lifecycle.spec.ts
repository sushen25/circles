import { expect, test, type Page } from './fixtures';
import { signedInAs } from './journeys';
import {
  circleOwnedBy,
  guestInvited,
  guestWhoAnswered,
  plansIn,
  revisionOf,
  signedInAccount,
  sql,
} from './stack';

/**
 * The organiser's plan lifecycle end to end (S1-26, spec §5.3): a plan made
 * from the full setup, and an edit that says who it asks again before it
 * saves. A locked-in time changed and a plan called off are
 * `cancel-reschedule.spec.ts`.
 */

async function asMaya(page: Page): Promise<string> {
  const maya = await signedInAccount('Maya');
  await signedInAs(page, maya.stored);
  return maya.userId;
}

test('the full setup makes the plan it showed, and an edit names who it asks again', async ({
  page,
}) => {
  const maya = await asMaya(page);
  const circleId = circleOwnedBy(maya, 'Sunday Crew');

  await page.goto(`/circles/${circleId}/plan/setup`);
  await page.getByRole('checkbox', { name: 'Dinner' }).click();
  await page.getByRole('checkbox', { name: 'Next 7 days' }).click();
  await page.getByRole('checkbox', { name: '1.5 hrs' }).click();
  await expect(page.getByText('Replies close in 24 hours')).toBeVisible();
  await page.getByRole('button', { name: 'Ask the group' }).click();

  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/plan/[^/]+/shared$`));
  const [plan] = plansIn(circleId);
  expect(plan).toBeDefined();
  const [row] = sql(`select title, category, duration_minutes, window_end - window_start,
    quorum_source from public.plans where id = '${plan!.id}'`);
  expect(row).toEqual(['Dinner', 'dinner', '90', '6', 'defaulted']);

  // Tom has answered; Alex has not; Maya has not either.
  const scenario = { circleId, planId: plan!.id, planCode: plan!.code, ownerId: maya, secret: '' };
  guestWhoAnswered(scenario, 'Tom');
  guestInvited(scenario, 'Alex');

  await page.goto(`/circles/${circleId}/plan/${plan!.id}/edit`);
  await page.getByRole('checkbox', { name: 'Next 14 days' }).click();
  await expect(
    page.getByText(
      'Changing this means Tom will be asked for their times again, and you and Alex get a fresh ask. Anything sent for the old times is cleared.',
    ),
  ).toBeVisible();
  expect(revisionOf(plan!.id)).toBe(1);
  await page.getByRole('button', { name: 'Save and ask again' }).click();

  await expect(page.getByText('Ask Sunday Crew again.')).toBeVisible();
  expect(revisionOf(plan!.id)).toBe(2);
});
