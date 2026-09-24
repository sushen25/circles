import { expect, test } from './fixtures';
import { memberNamed, sql, sundayCrew } from './stack';

/**
 * The invite link's edges (spec §5.1; S1-24): a tab already on `/join`, a name
 * somebody has, a circle with no plan asking, a revoked link. The journey
 * through it is `guest.spec.ts`, and the ways back in are `continuity.spec.ts`.
 * Each ends in the database, because the membership row is what a join is.
 */

test('an invite opened in a tab already on /join is read, and taken out of the address bar', async ({
  page,
}) => {
  // Pasting the link into a tab already on /join, or an in-app browser reusing
  // its tab, changes only the fragment. The browser does not reload for that, so
  // anything that runs once per page load never sees the new secret — and the
  // router would keep it in the address bar.
  const crew = sundayCrew();

  await page.goto('/join');
  await expect(page.getByText('Open the invite link again.')).toBeVisible();

  await page.goto(`/join#${crew.secret}`);

  await expect(page.getByText('Sunday Crew is finding a time to catch up.')).toBeVisible();
  expect(page.url()).not.toContain('#');
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
