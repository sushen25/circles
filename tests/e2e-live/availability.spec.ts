// @e2e: in-app-browser, locale
import { expect, test, type Page } from './fixtures';

import {
  answerOf,
  firstDayOf,
  memberNamed,
  planStopsAsking,
  sql,
  stackConfig,
  sundayCrew,
  type Scenario,
} from './stack';

/**
 * Answering a plan, end to end (spec §5.5, S1-25, ADR 0024, ADR 0068): days
 * tapped in the page, windows in the database, and the same answer when the
 * page opens again. Every test runs in the in-app browsers as well as the two engines
 * (WhatsApp's is the one the touch editor is most likely to meet), and in the
 * en-AU project, because the editor writes dates.
 *
 * Each starts as a stranger on the plan's link in a circle with no guests, so
 * the way in is the name step and nothing else (S1-24d): the editor is what
 * the test is about.
 */

/** Joins as `name` and waits for the editor. Returns the new member's user id. */
async function arriveAs(page: Page, crew: Scenario, name: string): Promise<string> {
  await page.goto(`/j/${crew.planCode}`);
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(
    page.getByRole('heading', { name: /^Which (evenings|days) could work\?$/ }),
  ).toBeVisible();
  const member = memberNamed(crew.circleId, name);
  expect(member, `${name} joined`).toBeDefined();
  return member!.userId;
}

/** The same plan asking about the whole day: Evening, Daytime and Any time are real choices. */
function wholeDay(crew: Scenario) {
  sql(`update public.plans set daily_start_local = 540 where id = '${crew.planId}'`);
}

/** The plan's nth day, as the date an answer's rows are keyed by. */
function nthDay(planId: string, n: number) {
  const date = new Date(`${firstDayOf(planId)}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}

/** The plan's days, in the grid, in date order. */
const days = (page: Page) =>
  page.getByRole('group', { name: 'Days in this plan' }).getByRole('button');
/** "Adjust hours" under the hours line, on a plan with one window: it opens the list of days. */
const adjustHours = (page: Page) => page.getByRole('button', { name: 'Adjust hours', exact: true });
/** "Not the same every day?": swaps the block for "A time for each day", in place. */
const notTheSame = (page: Page) => page.getByRole('button', { name: 'Not the same every day?' });
const sameForEvery = (page: Page) => page.getByRole('button', { name: 'Same for every day' });
/** A time-of-day pill: the block's, or (by `nth`) a day's. */
const pill = (page: Page, name: string) => page.getByRole('radio', { name, exact: true });
/** The first day's clock, which opens that day's From – to pairs on a sheet. */
const firstClock = (page: Page) => page.getByRole('button', { name: /^Exact hours, / }).first();
/** A From or To button of the open day, by what it says now ("Free from, Monday 14 September, 5:30 pm"). */
const timeButton = (page: Page, which: 'from' | 'to', time: string) =>
  page.getByRole('button', {
    name: new RegExp(`^Free ${which === 'from' ? 'from' : 'until'}, .*, ${time}$`),
  });
/** Opens that button's picker and chooses a time from it. */
async function pick(page: Page, which: 'from' | 'to', now: string, time: string) {
  await timeButton(page, which, now).click();
  await page.getByRole('radio', { name: time, exact: true }).click();
}

/** Taps `indices` in the grid; each gets the evening. */
async function evenings(page: Page, ...indices: number[]) {
  for (const index of indices) {
    await days(page).nth(index).click();
    await expect(days(page).nth(index)).toHaveAttribute('aria-pressed', 'true');
  }
}

/** From the first screen to the half hours of the first tapped day, on its sheet. */
async function exactHours(page: Page) {
  // This plan asks about an evening only: no pills, and the list opens in place.
  await adjustHours(page).click();
  await expect(page.getByRole('heading', { name: 'Your hours each evening' })).toBeVisible();
  await firstClock(page).click();
  await expect(timeButton(page, 'from', '\\d.*')).toBeVisible();
}

test('three days tapped is the answer, in four taps, and it comes back as it was given', async ({
  page,
}) => {
  const crew = sundayCrew();
  const ren = await arriveAs(page, crew, 'Ren');
  const started = Date.now();

  // Three days, Send: the block says the rest (ADR 0068's acceptance).
  await days(page).nth(1).click();
  await days(page).nth(3).click();
  await days(page).nth(5).click();
  await expect(page.getByText('From 5:30 pm')).toBeVisible();
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

  // The round trip: the same days and ranges when the page opens again.
  await page.goto(`/j/${crew.planCode}`);
  for (const index of [1, 3, 5]) {
    await expect(days(page).nth(index)).toHaveAccessibleName(/, 5:30–10:30\spm/);
    await expect(days(page).nth(index)).toHaveAttribute('aria-pressed', 'true');
  }
  await expect(days(page).nth(0)).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByText('From 5:30 pm')).toBeVisible();
});

test('what is set with From and to is what is stored, in two windows, and it comes back that way', async ({
  page,
}) => {
  const crew = sundayCrew();
  const ren = await arriveAs(page, crew, 'Ren');

  // 5:30–6:30 pm and 7:30–8 pm on the first day: two pairs, so two windows.
  await evenings(page, 0);
  await exactHours(page);
  await pick(page, 'to', '10:30 pm', '6:30 pm');
  await page.getByRole('button', { name: 'Add another time' }).click();
  await pick(page, 'from', '7:00 pm', '7:30 pm');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Free from, / })).toHaveCount(0);
  await page.getByRole('button', { name: 'Send my times' }).click();
  await expect(page).toHaveURL(new RegExp(`/j/${crew.planCode}/sent$`));

  const day = firstDayOf(crew.planId);
  expect(answerOf(crew.planId, ren)).toEqual({
    status: 'windows',
    windows: [`${day} 17:30–18:30`, `${day} 19:30–20:00`],
  });

  await page.goto(`/j/${crew.planCode}`);
  await expect(days(page).nth(0)).toHaveAttribute('aria-pressed', 'true');
  await exactHours(page);
  await expect(timeButton(page, 'from', '5:30 pm')).toBeVisible();
  await expect(timeButton(page, 'to', '6:30 pm')).toBeVisible();
  await expect(timeButton(page, 'from', '7:30 pm')).toBeVisible();
  await expect(timeButton(page, 'to', '8:00 pm')).toBeVisible();
});

test('an answer can be given from the keyboard alone, by days, pills and a sheet, and adjusted by the cell', async ({
  page,
}) => {
  const crew = sundayCrew();
  wholeDay(crew);
  const ren = await arriveAs(page, crew, 'Ren');

  await days(page).nth(0).focus();
  await page.keyboard.press('Space');
  await expect(days(page).nth(0)).toHaveAttribute('aria-pressed', 'true');
  // The pills are radios a keyboard reaches: Daytime, then back to Evening.
  await expect(pill(page, 'Evening')).toHaveAttribute('aria-checked', 'true');
  await pill(page, 'Daytime').focus();
  await page.keyboard.press('Space');
  await expect(pill(page, 'Daytime')).toHaveAttribute('aria-checked', 'true');
  await pill(page, 'Evening').focus();
  await page.keyboard.press('Enter');
  await expect(pill(page, 'Evening')).toHaveAttribute('aria-checked', 'true');
  await notTheSame(page).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'A time for each day' })).toBeVisible();
  // A day's own pills, and its clock.
  await pill(page, 'Any').focus();
  await expect(pill(page, 'Any')).toBeFocused();
  await firstClock(page).focus();
  await page.keyboard.press('Enter');
  // The picker is a list of radios a keyboard can reach: open it with Enter,
  // choose 6 pm with Space.
  await timeButton(page, 'from', '5:30 pm').focus();
  await page.keyboard.press('Enter');
  await page.getByRole('radio', { name: '6:00 pm', exact: true }).focus();
  await page.keyboard.press('Space');
  await expect(timeButton(page, 'from', '6:00 pm')).toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).focus();
  await page.keyboard.press('Enter');

  await page.getByRole('button', { name: 'Send my times' }).click();
  await expect(page).toHaveURL(new RegExp(`/sent$`));

  const day = firstDayOf(crew.planId);
  expect(answerOf(crew.planId, ren)?.windows).toEqual([`${day} 18:00–22:30`]);
  // (the whole-day plan's evening is the same 5:30 to 10:30 pm)
});

test('a plan with one window has nothing to pick: the title names it, and Adjust hours opens the list of days', async ({
  page,
}) => {
  const crew = sundayCrew();
  await arriveAs(page, crew, 'Ren');

  await expect(page.getByRole('heading', { name: 'Which evenings could work?' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'None of these evenings work for me' }),
  ).toBeVisible();
  await evenings(page, 1, 3);
  await expect(page.getByText('From 5:30 pm')).toBeVisible();
  await expect(page.getByText('2 days', { exact: true })).toBeVisible();
  await expect(notTheSame(page)).toHaveCount(0);
  await adjustHours(page).click();
  await expect(page.getByRole('radio')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Your hours each evening' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Exact hours, / })).toHaveCount(2);
  await sameForEvery(page).click();
  await expect(page.getByText('From 5:30 pm')).toBeVisible();
});

test('on a whole-day plan the block offers Evening, Daytime and Any time, and a pick applies to every tapped day', async ({
  page,
}) => {
  const crew = sundayCrew();
  wholeDay(crew);
  await arriveAs(page, crew, 'Ren');

  await expect(page.getByRole('heading', { name: 'Which days could work?' })).toBeVisible();
  // Nothing tapped, no block.
  await expect(page.getByRole('radio')).toHaveCount(0);
  await evenings(page, 1, 3);
  await expect(page.getByRole('heading', { name: 'When, on those days?' })).toBeVisible();
  await expect(page.getByText('2 days', { exact: true })).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(3);
  await expect(pill(page, 'Evening')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('From 5:30 pm')).toBeVisible();
  await pill(page, 'Daytime').click();
  await expect(page.getByText('9 am–5 pm')).toBeVisible();
  await expect(days(page).nth(1)).toHaveAccessibleName(/, 9 am.5 pm$/);
  await expect(days(page).nth(3)).toHaveAccessibleName(/, 9 am.5 pm$/);
  // No day list, no Change time, no sheet.
  await expect(page.getByRole('button', { name: /Change time/ })).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('a day can have its own time of day, its clock sets exact hours, and Same for every day brings them back', async ({
  page,
}) => {
  const crew = sundayCrew();
  wholeDay(crew);
  await arriveAs(page, crew, 'Ren');

  await evenings(page, 1, 3);
  await notTheSame(page).click();
  await expect(page.getByRole('heading', { name: 'When, on those days?' })).toHaveCount(0);
  // Each row offers Evening, Daytime and Any, the evening selected, and a clock.
  await expect(pill(page, 'Evening')).toHaveCount(2);
  await expect(pill(page, 'Daytime')).toHaveCount(2);
  await expect(pill(page, 'Any')).toHaveCount(2);
  await expect(pill(page, 'Evening').first()).toHaveAttribute('aria-checked', 'true');
  await pill(page, 'Daytime').nth(1).click();
  await expect(pill(page, 'Daytime').nth(1)).toHaveAttribute('aria-checked', 'true');
  await expect(pill(page, 'Daytime').first()).toHaveAttribute('aria-checked', 'false');

  // One day's own hours: the clock opens its sheet, and no choice is selected after.
  await firstClock(page).click();
  await pick(page, 'from', '5:30 pm', '6:00 pm');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(pill(page, 'Evening').first()).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByText('6–10:30 pm')).toBeVisible();

  // Same for every day: the last shared choice, on every day.
  await sameForEvery(page).click();
  await expect(page.getByRole('heading', { name: 'When, on those days?' })).toBeVisible();
  await expect(pill(page, 'Evening')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('From 5:30 pm')).toBeVisible();
});

test("a clock's sheet goes Back to the choice the day had, and clears its exact hours", async ({
  page,
}) => {
  const crew = sundayCrew();
  wholeDay(crew);
  const ren = await arriveAs(page, crew, 'Ren');

  await evenings(page, 1);
  await notTheSame(page).click();
  await firstClock(page).click();
  await pick(page, 'to', '10:30 pm', '9:00 pm');
  await page.getByRole('button', { name: 'Back to Evening instead' }).click();
  await expect(page.getByRole('button', { name: /^Free from, / })).toHaveCount(0);
  await expect(pill(page, 'Evening')).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Send my times' }).click();
  await expect(page).toHaveURL(new RegExp(`/sent$`));
  expect(answerOf(crew.planId, ren)?.windows).toEqual([`${nthDay(crew.planId, 1)} 17:30–22:30`]);
});

test('on a wide window the hours sheet and A time for each day sit in the centred column', async ({
  page,
}) => {
  const crew = sundayCrew();
  wholeDay(crew);
  await page.setViewportSize({ width: 1280, height: 800 });
  await arriveAs(page, crew, 'Ren');
  await evenings(page, 1, 3);
  await notTheSame(page).click();

  // A time for each day: the heading is on the column's left edge.
  const heading = page.getByRole('heading', { name: 'A time for each day' });
  await expect(heading).toBeVisible();
  const h = (await heading.boundingBox())!;
  expect(h.x).toBeCloseTo(422, 0);

  // The sheet: at most 480 wide, centred, on the bottom of the window, with the
  // scrim across the whole of it (manifesto 5.3).
  await firstClock(page).click();
  const sheetDone = page.getByRole('button', { name: 'Done', exact: true });
  // The sheet slides in; measure once it has stopped.
  let lastAt = '';
  await expect
    .poll(async () => {
      const at = (await sheetDone.boundingBox())!;
      const now = `${Math.round(at.x)},${Math.round(at.y)}`;
      const still = now === lastAt;
      lastAt = now;
      return still;
    })
    .toBe(true);
  const box = (await sheetDone.boundingBox())!;
  expect(box.width).toBeCloseTo(480 - 2 * 22, 0);
  expect(box.x + box.width / 2).toBeCloseTo(640, 0);
  expect(box.y + box.height).toBeLessThanOrEqual(800);

  // Beside the sheet is still the scrim: a tap there dismisses it, as Done does.
  await page.mouse.click(10, 790);
  await expect(page.getByRole('button', { name: /^Free from, / })).toHaveCount(0);
  const sideways = await page.evaluate(
    'document.documentElement.scrollWidth - document.documentElement.clientWidth',
  );
  expect(sideways).toBeLessThanOrEqual(0);
});

test('times set offline wait on the phone and go when the connection comes back', async ({
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

  await page.getByRole('button', { name: 'None of these evenings work for me' }).click();
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

test('A time for each day is part of the first screen: the address does not change, and a draft whose days differ reopens on it', async ({
  page,
}) => {
  const crew = sundayCrew();
  wholeDay(crew);
  await arriveAs(page, crew, 'Ren');
  await evenings(page, 1, 3);
  await notTheSame(page).click();
  await expect(page.getByRole('heading', { name: 'A time for each day' })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/j/${crew.planCode}$`));

  // Wait for the device to keep the change before leaving the page.
  const before = await page.evaluate('JSON.stringify(localStorage)');
  await pill(page, 'Daytime').nth(1).click();
  await expect.poll(() => page.evaluate('JSON.stringify(localStorage)')).not.toBe(before);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Which days could work?' })).toBeVisible();
  await expect(days(page).nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(days(page).nth(3)).toHaveAttribute('aria-pressed', 'true');
  // The days differ, so the block opens as the list.
  await expect(page.getByRole('heading', { name: 'A time for each day' })).toBeVisible();
  await expect(pill(page, 'Daytime').nth(1)).toHaveAttribute('aria-checked', 'true');
});
