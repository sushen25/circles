import { expect, test, type Page } from '@playwright/test';

import {
  answerOf,
  clearRateCounters,
  firstDayOf,
  memberNamed,
  planStopsAsking,
  stackConfig,
  sundayCrew,
  type Scenario,
} from './stack';

/**
 * Answering a plan, end to end (spec §5.5, S1-25, ADR 0024): days and a block
 * in the page, windows in the database, and the same answer when the page opens
 * again. Every test runs in all three user agents, WhatsApp's in-app browser
 * among them.
 *
 * Each starts as a stranger on the plan's link in a circle with no guests, so
 * the way in is the name step and nothing else (S1-24d): the editor is what
 * the test is about.
 */

test.beforeEach(() => {
  clearRateCounters();
});

/** Joins as `name` and waits for the editor. Returns the new member's user id. */
async function arriveAs(page: Page, crew: Scenario, name: string): Promise<string> {
  await page.goto(`/j/${crew.planCode}`);
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText("Times I'd actually be up for")).toBeVisible();
  const member = memberNamed(crew.circleId, name);
  expect(member, `${name} joined`).toBeDefined();
  return member!.userId;
}

/** The plan's days, in the grid, in date order. */
const days = (page: Page) =>
  page.getByRole('group', { name: 'Days in this plan' }).getByRole('button');
const evening = (page: Page) => page.getByRole('checkbox', { name: /^Evening/ });
/** The first day's line in "My answer", which opens to its half hours. */
const firstLine = (page: Page) =>
  page.getByRole('button', { name: /Adjust by the half hour$/ }).first();
/** The half hours of the open day. */
const cells = (page: Page) => page.getByRole('checkbox', { name: / to / });

/** Ticks `indices` in the grid and turns Evening on for them. */
async function evenings(page: Page, ...indices: number[]) {
  for (const index of indices) {
    await days(page).nth(index).click();
    await expect(days(page).nth(index)).toHaveAttribute('aria-pressed', 'true');
  }
  await evening(page).click();
  await expect(evening(page)).toHaveAttribute('aria-checked', 'true');
}

test('three days and Evening is the answer, in five taps, and it comes back as it was given', async ({
  page,
}) => {
  const crew = sundayCrew();
  const ren = await arriveAs(page, crew, 'Ren');
  const started = Date.now();

  // Three days, Evening, Send (ADR 0024's acceptance: five taps).
  await days(page).nth(1).click();
  await days(page).nth(3).click();
  await days(page).nth(5).click();
  await evening(page).click();
  await expect(page.getByText('3 of 7 days')).toBeVisible();
  await page.getByRole('button', { name: 'Send my times' }).click();

  await expect(page).toHaveURL(new RegExp(`/j/${crew.planCode}/sent$`));
  // Scripted, so this is the floor rather than a person's time; the ticket's
  // under-a-minute median is measured by hand and is in the testing notes.
  console.log(`answered and sent in ${Date.now() - started} ms`);

  const first = firstDayOf(crew.planId);
  const dayAfter = (n: number) => {
    const date = new Date(`${first}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + n);
    return date.toISOString().slice(0, 10);
  };
  expect(answerOf(crew.planId, ren)).toEqual({
    status: 'windows',
    windows: [1, 3, 5].map((n) => `${dayAfter(n)} 17:30–22:30`),
  });

  // The round trip: the same days, tags and ranges when the page opens again.
  await page.goto(`/j/${crew.planCode}`);
  for (const index of [1, 3, 5]) {
    await expect(days(page).nth(index)).toHaveAccessibleName(/, 5:30–10:30\spm$/);
    await expect(days(page).nth(index)).toContainText('Eve');
  }
  await expect(days(page).nth(0)).toHaveAccessibleName(/, no times yet$/);
  await expect(page.getByText('3 of 7 days')).toBeVisible();
});

test('what is adjusted by the half hour is what is stored, and it comes back that way', async ({
  page,
}) => {
  const crew = sundayCrew();
  const ren = await arriveAs(page, crew, 'Ren');

  // 5:30–6:30 pm and 7:30–8 pm on the first day: two runs, so two windows.
  await evenings(page, 0);
  await firstLine(page).click();
  // "Clear" and the day's name: the open day's own button, not "Clear these days".
  await page.getByRole('button', { name: /^Clear (?!these days)/ }).click();
  await cells(page).nth(0).click();
  await cells(page).nth(1).click();
  await cells(page).nth(4).click();
  await expect(page.getByText('1 of 7 days')).toBeVisible();
  await page.getByRole('button', { name: 'Send my times' }).click();
  await expect(page).toHaveURL(new RegExp(`/j/${crew.planCode}/sent$`));

  const day = firstDayOf(crew.planId);
  expect(answerOf(crew.planId, ren)).toEqual({
    status: 'windows',
    windows: [`${day} 17:30–18:30`, `${day} 19:30–20:00`],
  });

  await page.goto(`/j/${crew.planCode}`);
  await expect(days(page).nth(0)).toContainText('Some');
  await firstLine(page).click();
  await expect(cells(page).nth(0)).toHaveAttribute('aria-checked', 'true');
  await expect(cells(page).nth(1)).toHaveAttribute('aria-checked', 'true');
  await expect(cells(page).nth(2)).toHaveAttribute('aria-checked', 'false');
  await expect(cells(page).nth(4)).toHaveAttribute('aria-checked', 'true');
});

test('an answer can be given from the keyboard alone, by days and a block, and adjusted by the cell', async ({
  page,
}) => {
  const crew = sundayCrew();
  const ren = await arriveAs(page, crew, 'Ren');

  await days(page).nth(0).focus();
  await page.keyboard.press('Space');
  await expect(days(page).nth(0)).toHaveAttribute('aria-pressed', 'true');
  await evening(page).focus();
  await page.keyboard.press('Space');
  await expect(evening(page)).toHaveAttribute('aria-checked', 'true');

  await firstLine(page).focus();
  await page.keyboard.press('Enter');
  await expect(firstLine(page)).toHaveAttribute('aria-expanded', 'true');
  await cells(page).nth(0).focus();
  await page.keyboard.press('Space');
  await expect(cells(page).nth(0)).toHaveAttribute('aria-checked', 'false');

  await page.getByRole('button', { name: 'Send my times' }).click();
  await expect(page).toHaveURL(new RegExp(`/sent$`));

  const day = firstDayOf(crew.planId);
  expect(answerOf(crew.planId, ren)?.windows).toEqual([`${day} 18:00–22:30`]);
});

test('times painted offline wait on the phone and go when the connection comes back', async ({
  page,
  context,
}) => {
  const crew = sundayCrew();
  const ren = await arriveAs(page, crew, 'Ren');

  await context.setOffline(true);
  await evenings(page, 0, 1, 2, 3, 4, 5, 6);
  await page.getByRole('button', { name: 'Send my times' }).click();
  await expect(page.getByText('Your times are saved on this phone.')).toBeVisible();
  expect(answerOf(crew.planId, ren), 'nothing has reached the server').toBeUndefined();

  await context.setOffline(false);

  await expect(page).toHaveURL(new RegExp(`/j/${crew.planCode}/sent$`));
  expect(answerOf(crew.planId, ren)?.windows).toHaveLength(7);
});

test('a draft survives a reload while the server is out of reach, then sends', async ({ page }) => {
  const crew = sundayCrew();
  const ren = await arriveAs(page, crew, 'Ren');
  const api = `${stackConfig().apiUrl}/**`;

  // Out of reach rather than offline: the page itself still loads, as it does
  // from a cache, and the browser still believes it is online — the train
  // between towers, the hotel wifi before its login page.
  await page.route(api, (route) => route.abort('internetdisconnected'));
  await evenings(page, 0);
  await page.getByRole('button', { name: 'Send my times' }).click();
  await expect(page.getByText('Your times are saved on this phone.')).toBeVisible();

  await page.reload();
  await expect(page.getByText('Your times are saved on this phone.')).toBeVisible();
  expect(answerOf(crew.planId, ren)).toBeUndefined();

  await page.unroute(api);
  // Coming back to the page is a chance to send (`onChanceToResend`).
  // A string, because the test project has no DOM library.
  await page.evaluate("window.dispatchEvent(new Event('online'))");

  await expect(page).toHaveURL(new RegExp(`/sent$`));
  const day = firstDayOf(crew.planId);
  expect(answerOf(crew.planId, ren)?.windows).toEqual([`${day} 17:30–22:30`]);
});

test("I'm easy is stored as flexible, with no windows", async ({ page }) => {
  const crew = sundayCrew();
  const ren = await arriveAs(page, crew, 'Ren');

  await evenings(page, 0);
  await page.getByRole('switch', { name: "I'm easy" }).click();
  await page.getByRole('button', { name: 'Send my times' }).click();

  await expect(page).toHaveURL(new RegExp(`/sent$`));
  expect(answerOf(crew.planId, ren)).toEqual({ status: 'flexible', windows: [] });
});

test('"not enough notice" is its own answer, not a decline', async ({ page }) => {
  const crew = sundayCrew();
  const ren = await arriveAs(page, crew, 'Ren');

  await page.getByRole('button', { name: 'None of these dates work for me' }).click();
  await expect(page.getByText("Maya sees you'd like to come.", { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Not enough notice' }).click();

  await expect(page).toHaveURL(new RegExp(`/sent$`));
  expect(answerOf(crew.planId, ren)).toEqual({ status: 'more_notice', windows: [] });
});

test('a plan past its deadline, still marked collecting, says replies have closed', async ({
  page,
}) => {
  // The deadline is judged on the database's clock (`'now'` through
  // PostgREST), not the phone's: this is the proof the filter reaches Postgres
  // as the time and not as a string.
  const crew = sundayCrew();
  await arriveAs(page, crew, 'Ren');

  planStopsAsking(crew, 'deadline_passed');
  await page.reload();

  await expect(page.getByText('Replies have closed for this one.')).toBeVisible();
});
