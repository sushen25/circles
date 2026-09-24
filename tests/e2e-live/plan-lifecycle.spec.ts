import { expect, test, type Browser, type Page } from '@playwright/test';

import {
  circleOwnedBy,
  clearRateCounters,
  guestInvited,
  guestWhoAnswered,
  lockInFirstOption,
  planFor,
  plansIn,
  revisionOf,
  sessionStorageKey,
  signedInAccount,
  sql,
} from './stack';

/**
 * The organiser's plan lifecycle end to end (S1-26, spec §5.3, §5.7): a plan
 * made from the full setup, an edit that says who it asks again before it
 * saves, a locked-in time changed, and a plan called off — each read back from
 * the database, and each seen from a member's side of the link.
 */

test.beforeEach(() => {
  clearRateCounters();
});

async function asMaya(page: Page): Promise<string> {
  const maya = await signedInAccount('Maya');
  await page.addInitScript({
    content: `localStorage.setItem(${JSON.stringify(sessionStorageKey())}, ${JSON.stringify(maya.stored)});`,
  });
  return maya.userId;
}

/** Ticks a day, turns Evening on and sends. The editor is S1-25's; this uses it. */
async function answersIn(page: Page, code: string): Promise<void> {
  await expect(page.getByText("Times I'd actually be up for")).toBeVisible();
  await page.getByRole('group', { name: 'Days in this plan' }).getByRole('button').nth(1).click();
  await page.getByRole('checkbox', { name: /^Evening/ }).click();
  await page.getByRole('button', { name: 'Send my times' }).click();
  await expect(page).toHaveURL(new RegExp(`/j/${code}/sent$`));
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
  await answersIn(ren, code);
  await page.goto(`/j/${code}`);
  await answersIn(page, code);
  return ren;
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
