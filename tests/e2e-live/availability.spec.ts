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

/** The plan's days, in the grid, in date order. */
const days = (page: Page) =>
  page.getByRole('group', { name: 'Days in this plan' }).getByRole('button');
/** "Change time" under the grid, which opens the sheet ("Adjust hours" on a plan with one window). */
const changeTime = (page: Page) => page.getByRole('button', { name: /^Change the time for/ });
const adjustHours = (page: Page) => page.getByRole('button', { name: /^Adjust hours for/ });
const exactLink = (page: Page) =>
  page.getByRole('button', { name: 'A different time for each day' });
/** The first day's "Set exact hours", which opens that day's From – to pairs. */
const firstLine = (page: Page) => page.getByRole('button', { name: /Set exact hours$/ }).first();
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

/** From the first screen to the half hours of the first tapped day. */
async function exactHours(page: Page) {
  // This plan asks about an evening only: nothing to pick, so no sheet.
  await adjustHours(page).click();
  await expect(page.getByRole('heading', { name: 'Your hours each evening' })).toBeVisible();
  await firstLine(page).click();
  await expect(firstLine(page)).toHaveAttribute('aria-expanded', 'true');
}

test('three days tapped is the answer, in four taps, and it comes back as it was given', async ({
  page,
}) => {
  const crew = sundayCrew();
  const ren = await arriveAs(page, crew, 'Ren');
  const started = Date.now();

  // Three days, Send: one answer line says the rest (ADR 0068's acceptance).
  await days(page).nth(1).click();
  await days(page).nth(3).click();
  await days(page).nth(5).click();
  await expect(page.getByText('Evenings, from 5:30 pm')).toBeVisible();
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
  await expect(page.getByText('Evenings, from 5:30 pm')).toBeVisible();
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
  await expect(page.getByText(/set by the half hour/)).toBeVisible();
  await page.getByRole('button', { name: 'Send my times' }).click();
  await expect(page).toHaveURL(new RegExp(`/j/${crew.planCode}/sent$`));

  const day = firstDayOf(crew.planId);
  expect(answerOf(crew.planId, ren)).toEqual({
    status: 'windows',
    windows: [`${day} 17:30–18:30`, `${day} 19:30–20:00`],
  });

  await page.goto(`/j/${crew.planCode}`);
  await expect(days(page).nth(0)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText(/set by the half hour/)).toBeVisible();
  await exactHours(page);
  await expect(timeButton(page, 'from', '5:30 pm')).toBeVisible();
  await expect(timeButton(page, 'to', '6:30 pm')).toBeVisible();
  await expect(timeButton(page, 'from', '7:30 pm')).toBeVisible();
  await expect(timeButton(page, 'to', '8:00 pm')).toBeVisible();
});

test('an answer can be given from the keyboard alone, by days and a sheet, and adjusted by the cell', async ({
  page,
}) => {
  const crew = sundayCrew();
  wholeDay(crew);
  const ren = await arriveAs(page, crew, 'Ren');

  await days(page).nth(0).focus();
  await page.keyboard.press('Space');
  await expect(days(page).nth(0)).toHaveAttribute('aria-pressed', 'true');
  await changeTime(page).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('radio', { name: /^Evening/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await exactLink(page).focus();
  await page.keyboard.press('Enter');
  await firstLine(page).focus();
  await page.keyboard.press('Enter');
  await expect(firstLine(page)).toHaveAttribute('aria-expanded', 'true');
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

test('a plan with one window has nothing to pick: the title names it, and Adjust hours goes to the list of days', async ({
  page,
}) => {
  const crew = sundayCrew();
  await arriveAs(page, crew, 'Ren');

  await expect(page.getByRole('heading', { name: 'Which evenings could work?' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'None of these evenings work for me' }),
  ).toBeVisible();
  await evenings(page, 1, 3);
  await expect(page.getByText('Evenings, from 5:30 pm')).toBeVisible();
  await expect(changeTime(page)).toHaveCount(0);
  await adjustHours(page).click();
  await expect(page.getByRole('radio')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Your hours each evening' })).toBeVisible();
  await expect(page.getByText('Every evening is from 5:30 pm.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: /Set exact hours$/ })).toHaveCount(2);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByText('Evenings, from 5:30 pm')).toBeVisible();
});

test('on a whole-day plan Change time offers Evening, Daytime and Any time, and Done leaves the answer as it was', async ({
  page,
}) => {
  const crew = sundayCrew();
  wholeDay(crew);
  await arriveAs(page, crew, 'Ren');

  await expect(page.getByRole('heading', { name: 'Which days could work?' })).toBeVisible();
  await evenings(page, 1, 3);
  await changeTime(page).click();
  await expect(page.getByText(/^One answer covers /)).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(3);
  await expect(page.getByRole('radio', { name: /^Evening/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.getByRole('radio', { name: /^Daytime, 9 am.5 pm$/ })).toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('radio')).toHaveCount(0);
  await expect(page.getByText('Evenings, from 5:30 pm')).toBeVisible();
});

test('a day can have its own time of day, and the line then lists each day', async ({ page }) => {
  const crew = sundayCrew();
  wholeDay(crew);
  await arriveAs(page, crew, 'Ren');

  await evenings(page, 1, 3);
  await changeTime(page).click();
  await exactLink(page).click();
  // Each card offers Evening, Daytime and Any time, the evening selected; the
  // half hours are a link away on each.
  await expect(page.getByRole('button', { name: /^Evening, / })).toHaveCount(2);
  await expect(page.getByRole('button', { name: /^Daytime, / })).toHaveCount(2);
  await expect(page.getByRole('button', { name: /^Evening, / }).first()).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page
    .getByRole('button', { name: /^Daytime, / })
    .nth(1)
    .click();

  // One day's own hours: a quick choice is no longer selected on it.
  await page
    .getByRole('button', { name: /Set exact hours$/ })
    .first()
    .click();
  await pick(page, 'from', '5:30 pm', '6:00 pm');
  await expect(page.getByText(/your own hours$/)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Evening, / }).first()).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  // The days differ, so the line lists each, and Change time goes straight back.
  await expect(page.getByText(/, but daytime on /)).toBeVisible();
  await changeTime(page).click();
  await expect(page.getByRole('heading', { name: 'A time for each day' })).toBeVisible();
  await page.getByRole('button', { name: 'Use one time for all days' }).click();
  await expect(page.getByText('Evenings, from 5:30 pm')).toBeVisible();
});

test('on a wide window the Change time sheet and A time for each day sit in the centred column', async ({
  page,
}) => {
  const crew = sundayCrew();
  wholeDay(crew);
  await page.setViewportSize({ width: 1280, height: 800 });
  await arriveAs(page, crew, 'Ren');
  await evenings(page, 1, 3);

  // The sheet: at most 480 wide, centred, on the bottom of the window, with the
  // scrim across the whole of it (manifesto 5.3).
  await changeTime(page).click();
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
  let box = (await sheetDone.boundingBox())!;
  expect(box.width).toBeCloseTo(480 - 2 * 22, 0);
  expect(box.x + box.width / 2).toBeCloseTo(640, 0);
  expect(box.y + box.height).toBeLessThanOrEqual(800);
  expect(box.y + box.height).toBeGreaterThan(740);

  // Beside the sheet is still the scrim: a tap there dismisses it.
  await page.mouse.click(10, 790);
  await expect(page.getByRole('radio')).toHaveCount(0);
  await changeTime(page).click();
  await expect(page.getByRole('radio')).toHaveCount(3);

  // A time for each day: the heading and Done share the column.
  await exactLink(page).click();
  const heading = page.getByRole('heading', { name: 'A time for each day' });
  await expect(heading).toBeVisible();
  const h = (await heading.boundingBox())!;
  box = (await sheetDone.boundingBox())!;
  expect(h.x).toBeCloseTo(422, 0);
  expect(box.x).toBeCloseTo(422, 0);
  expect(box.width).toBeCloseTo(480 - 2 * 22, 0);
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
