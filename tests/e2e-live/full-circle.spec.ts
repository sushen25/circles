// @e2e: core
import { expect, test } from './fixtures';
import { signedInAs } from './journeys';
import { circleOwnedBy, fillToCap, sessionFor, signedInAccount, sundayCrew } from './stack';

/**
 * The dead ends of SUS-199: a quiet ask with nobody to ask, and a circle at the
 * member cap (ADR 0012).
 *
 * The seed's The Big Table is read, never changed (like `seed.spec.ts`); the
 * stranger's refusal needs a circle with an invite, so it fills one of its own.
 */

// Seed scenario D, as `supabase/seed.sql` writes it: Maya owns The Big Table,
// which holds exactly `member_cap()` people.
const BIG_TABLE = '00000000-0000-4000-8000-000000000a04';

test('The Big Table, at the cap, says so on its home, in settings and on the invite page', async ({
  page,
}) => {
  test.skip(test.info().project.name !== 'android-chrome', 'the seed is the same in every project');
  await signedInAs(page, await sessionFor('maya@example.com'));

  await page.goto(`/circles/${BIG_TABLE}`);
  await expect(page.getByText('The Big Table is full (20 people)')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add someone' })).toHaveCount(0);
  await expect(page.getByText(/in so far/)).toHaveCount(0);

  await page.goto(`/circles/${BIG_TABLE}/settings`);
  await expect(page.getByText('The Big Table is full (20 people)')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add someone' })).toHaveCount(0);

  await page.goto(`/circles/${BIG_TABLE}/invite`);
  await expect(page.getByText('The Big Table is full (20 people)')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Circle settings' })).toBeVisible();
});

test('a quiet ask with nobody to ask leads the owner to inviting people', async ({ page }) => {
  const maya = await signedInAccount('Maya');
  const circleId = circleOwnedBy(maya.userId, 'Thursday Lot');
  await signedInAs(page, maya.stored);

  await page.goto(`/circles/${circleId}/quiet/new`);
  await expect(page.getByText("There's nobody else in Thursday Lot to ask yet.")).toBeVisible();
  await page.getByRole('button', { name: 'Invite people' }).click();

  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/invite$`));
});

test('a stranger on the join link of a full circle is told, neutrally, that it holds no more', async ({
  page,
}) => {
  const crew = sundayCrew({ withPlan: false });
  fillToCap(crew.circleId);

  await page.goto(`/join#${crew.secret}`);
  await page.getByRole('button', { name: 'Choose my times' }).click();
  await page.getByLabel('Your name').fill('Ren');
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(
    page.getByText('Sunday Crew already has 20 people, which is as many as a circle holds.'),
  ).toBeVisible();
  // No blame, no count of who was turned away, no way of finding out who is in.
  await expect(page.getByText(/sorry|can't join|rejected|declined/i)).toHaveCount(0);
});

test('a stranger on the plan link of a full circle is told the same', async ({ page }) => {
  const crew = sundayCrew();
  fillToCap(crew.circleId);

  await page.goto(`/p/${crew.planCode}`);
  await page.getByRole('button', { name: "I'm new here" }).click();
  await page.getByLabel('Your name').fill('Ren');
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(
    page.getByText('Sunday Crew already has 20 people, which is as many as a circle holds.'),
  ).toBeVisible();
});
