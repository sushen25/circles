import { expect, test, type Browser, type Page } from './fixtures';
import { sendEvenings, signedInAs } from './journeys';
import { circleOwnedBy, lockInFirstOption, planFor, signedInAccount, sql } from './stack';

/**
 * After a time is locked in (S1-26, spec §5.7): the organiser changes it, or
 * calls it off, and a member opening the same link learns which — Thursday is
 * off and new times are wanted, or it is cancelled and here is the note. Each
 * is read back from the database and then seen from the member's side.
 */

async function asMaya(page: Page): Promise<string> {
  const maya = await signedInAccount('Maya');
  await signedInAs(page, maya.stored);
  return maya.userId;
}

/**
 * Ren, new, joins from the plan link and answers, and so does Maya — which
 * runs the engine and gives the plan an option to lock in.
 */
async function bothAnswer(page: Page, browser: Browser, code: string): Promise<Page> {
  const ren = await (await browser.newContext()).newPage();
  // Nobody has joined this circle from a link before, so the name comes first.
  await ren.goto(`/p/${code}`);
  await ren.getByLabel('Your name').fill('Ren');
  await ren.getByRole('button', { name: 'Continue' }).click();
  await expect(ren).toHaveURL(new RegExp(`/j/${code}$`));
  await sendEvenings(ren, code);
  await page.goto(`/j/${code}`);
  await sendEvenings(page, code);
  return ren;
}

test('changing a locked-in time asks again, and a member hears Thursday is off first', async ({
  page,
  browser,
}) => {
  const maya = await asMaya(page);
  const circleId = circleOwnedBy(maya, 'Sunday Crew');
  const plan = planFor(circleId, maya);
  const ren = await bothAnswer(page, browser, plan.code);
  lockInFirstOption(plan.id, maya);

  await page.goto(`/circles/${circleId}/plan/${plan.id}/confirmed`);
  await page.getByRole('button', { name: 'Change the time' }).click();
  await expect(page.getByText('Ask for new times?')).toBeVisible();
  const ask = page.getByRole('button', { name: 'Ask again' });
  await expect(ask).not.toHaveAttribute('aria-disabled', 'true');
  await ask.click();

  await expect(page).toHaveURL(/\/shared\?again=1$/);
  await expect(page.getByText(/^Change of plan: \w+ is off\. New times, please$/)).toBeVisible();
  expect(sql(`select state, revision from public.plans where id = '${plan.id}'`)[0]).toEqual([
    'collecting',
    '2',
  ]);

  await ren.goto(`/p/${plan.code}`);
  await expect(ren).toHaveURL(new RegExp(`/p/${plan.code}/rescheduled$`));
  await expect(ren.getByText('Previously')).toBeVisible();
  await expect(ren.getByText(/Maya reopened the plan\./)).toBeVisible();
  await ren.getByRole('button', { name: 'Choose my times' }).click();
  await expect(ren).toHaveURL(new RegExp(`/j/${plan.code}$`));
});

test('cancelling gives the organiser the update and a member the note', async ({
  page,
  browser,
}) => {
  const maya = await asMaya(page);
  const circleId = circleOwnedBy(maya, 'Sunday Crew');
  const plan = planFor(circleId, maya);
  const ren = await bothAnswer(page, browser, plan.code);
  lockInFirstOption(plan.id, maya);

  await page.goto(`/circles/${circleId}/plan/${plan.id}/confirmed`);
  await page.getByRole('button', { name: 'Cancel this plan' }).click();
  await expect(page.getByText(/^Cancel \w+'s catch-up\?$/)).toBeVisible();
  await page.getByLabel('A short note, optional').fill('Sorry all, next month.');
  await page.getByRole('button', { name: 'Cancel the catch-up' }).click();

  await expect(page).toHaveURL(new RegExp(`/plan/${plan.id}/cancelled$`));
  await expect(
    page.getByText(
      new RegExp(
        `^Update: \\w+'s Sunday Crew catch-up is off\\. Sorry all, next month\\. .*/p/${plan.code}$`,
      ),
    ),
  ).toBeVisible();
  expect(sql(`select state, cancel_note from public.plans where id = '${plan.id}'`)[0]).toEqual([
    'cancelled',
    'Sorry all, next month.',
  ]);

  await ren.goto(`/p/${plan.code}`);
  await expect(ren).toHaveURL(new RegExp(`/p/${plan.code}/cancelled$`));
  await expect(ren.getByText("Maya's note")).toBeVisible();
  await expect(ren.getByText('“Sorry all, next month.”')).toBeVisible();
});
