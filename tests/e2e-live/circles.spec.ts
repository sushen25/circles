import { expect, test, type Page } from '@playwright/test';

import {
  accountToSignInTo,
  circleOwnedBy,
  clearRateCounters,
  latestCodeFor,
  memberNamed,
  sql,
} from './stack';

/**
 * Running a circle (S1-23), against the real stack: the circles list, circle
 * settings' Reset link, and removing somebody — the screens, the functions
 * behind them, and the rows they leave.
 */

test.beforeEach(() => {
  clearRateCounters();
});

async function signInByCode(page: Page, email: string): Promise<void> {
  await page.goto('/sign-in');
  await page.getByLabel('Your email').fill(email);
  await page.getByRole('button', { name: 'Send me a code' }).click();
  await expect(page.getByText(`Sent to ${email}.`, { exact: false })).toBeVisible();
  await page.getByLabel('Code', { exact: true }).fill(await latestCodeFor(email));
  await page.getByRole('button', { name: 'Continue' }).click();
}

/** A guest already in the circle, who joined some time ago. */
function guestIn(circleId: string, name: string): string {
  const [[userId]] = sql(`
    with u as (
      insert into auth.users (
        id, instance_id, aud, role, email, is_anonymous, raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at
      ) values (
        gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        null, true, '{"is_anonymous": true}',
        '{"display_name": "${name}", "time_zone": "Australia/Melbourne"}', now(), now()
      ) returning id
    )
    insert into public.circle_members (circle_id, user_id, display_name_snapshot)
    select '${circleId}', id, '${name}' from u
    returning user_id
  `) as [[string]];
  return userId;
}

test('the owner resets a link nobody can show, and removes a member, from settings', async ({
  page,
}) => {
  const maya = await accountToSignInTo('Maya');
  // Made directly, with no invite: the case a reset exists for.
  const circleId = circleOwnedBy(maya.userId, 'Book Club');
  const tom = guestIn(circleId, 'Tom');
  guestIn(circleId, 'Priya');

  await signInByCode(page, maya.email);
  await expect(page).toHaveURL(/\/circles$/);
  await expect(page.getByRole('button', { name: 'Book Club. Not caught up yet' })).toBeVisible();

  await page.getByRole('button', { name: /^Book Club\./ }).click();
  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}$`));
  await page.getByRole('button', { name: 'Circle settings' }).click();

  await expect(page.getByText(/can't be shown again/)).toBeVisible();
  await page.getByRole('button', { name: 'Reset link' }).click();
  await page
    .getByLabel('Reset the invite link?')
    .getByRole('button', { name: 'Reset link' })
    .click();
  await expect(page.getByText('New link ready. The old one no longer works.')).toBeVisible();
  await expect(page.getByText(/\/join#…\S{4}$/)).toBeVisible();
  expect(
    sql(`select count(*) from public.circle_invites
         where circle_id = '${circleId}' and revoked_at is null`)[0]?.[0],
  ).toBe('1');

  await page.getByRole('button', { name: 'Remove Tom' }).click();
  await page.getByLabel('Remove Tom?').getByRole('button', { name: 'Remove Tom' }).click();
  await expect(page.getByRole('button', { name: 'Remove Tom' })).toHaveCount(0);
  expect(memberNamed(circleId, 'Tom')).toBeUndefined();
  expect(
    sql(`select status from public.circle_members
         where circle_id = '${circleId}' and user_id = '${tom}'`)[0]?.[0],
  ).toBe('removed');
  await expect(page.getByRole('button', { name: 'Remove Priya' })).toBeVisible();
});
