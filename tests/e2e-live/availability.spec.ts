import { expect, test, type Page } from '@playwright/test';

import {
  answerOf,
  clearRateCounters,
  firstDayOf,
  memberNamed,
  stackConfig,
  sundayCrew,
  type Scenario,
} from './stack';

/**
 * Answering a plan, end to end (spec §5.5, S1-25): painted cells in the page,
 * windows in the database, and the same cells when the page opens again. Every
 * test runs in all three user agents, WhatsApp's in-app browser among them.
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

/** The first day's row, by its group. */
const firstDay = (page: Page) => page.getByRole('group').first().getByRole('checkbox');

test('what is painted is what is stored, and it comes back painted', async ({ page }) => {
  const crew = sundayCrew();
  const ren = await arriveAs(page, crew, 'Ren');
  const started = Date.now();

  // 5:30–6:30 pm and 7:30–8 pm on the first day: two runs, so two windows.
  await firstDay(page).nth(0).click();
  await firstDay(page).nth(1).click();
  await firstDay(page).nth(4).click();
  await expect(page.getByText('1 of 7 days')).toBeVisible();
  await page.getByRole('button', { name: 'Send my times' }).click();

  await expect(page).toHaveURL(new RegExp(`/j/${crew.planCode}/sent$`));
  // Scripted, so this is the floor rather than a person's time; the ticket's
  // under-a-minute median is measured by hand and is in the testing notes.
  console.log(`painted and sent in ${Date.now() - started} ms`);

  const day = firstDayOf(crew.planId);
  expect(answerOf(crew.planId, ren)).toEqual({
    status: 'windows',
    windows: [`${day} 17:30–18:30`, `${day} 19:30–20:00`],
  });

  // The round trip: the server's windows, back on the grid as they were painted.
  await page.goto(`/j/${crew.planCode}`);
  await expect(firstDay(page).nth(0)).toHaveAttribute('aria-checked', 'true');
  await expect(firstDay(page).nth(1)).toHaveAttribute('aria-checked', 'true');
  await expect(firstDay(page).nth(2)).toHaveAttribute('aria-checked', 'false');
  await expect(firstDay(page).nth(4)).toHaveAttribute('aria-checked', 'true');
});

test('a range can be painted from the keyboard, one cell at a time, as a screen reader does', async ({
  page,
}) => {
  const crew = sundayCrew();
  const ren = await arriveAs(page, crew, 'Ren');

  for (const index of [2, 3, 4]) {
    await firstDay(page).nth(index).focus();
    await page.keyboard.press('Space');
    await expect(firstDay(page).nth(index)).toHaveAttribute('aria-checked', 'true');
  }
  await page.getByRole('button', { name: 'Send my times' }).click();
  await expect(page).toHaveURL(new RegExp(`/sent$`));

  const day = firstDayOf(crew.planId);
  expect(answerOf(crew.planId, ren)?.windows).toEqual([`${day} 18:30–20:00`]);
});

test('times painted offline wait on the phone and go when the connection comes back', async ({
  page,
  context,
}) => {
  const crew = sundayCrew();
  const ren = await arriveAs(page, crew, 'Ren');

  await context.setOffline(true);
  await page.getByRole('checkbox', { name: 'After work' }).click();
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
  await firstDay(page).nth(0).click();
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
  expect(answerOf(crew.planId, ren)?.windows).toEqual([`${day} 17:30–18:00`]);
});

test("I'm easy is stored as flexible, with no windows", async ({ page }) => {
  const crew = sundayCrew();
  const ren = await arriveAs(page, crew, 'Ren');

  await firstDay(page).nth(0).click();
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
