import type { Locator } from '@playwright/test';

import { expect, test, type Browser, type Page } from './fixtures';
import { joinsAndAnswers, signedInAs } from './journeys';
import {
  circleOwnedBy,
  guestInvited,
  guestWhoAnswered,
  planFor,
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

/**
 * A member of `circleId` with a saved place, asked by the plan, signed in on a
 * page of their own; answered "I'm easy" to its first revision when `answered`.
 */
async function memberOf(
  browser: Browser,
  circleId: string,
  planId: string,
  name: string,
  answered: boolean,
): Promise<Page> {
  const member = await signedInAccount(name);
  sql(`
    begin;
    insert into public.circle_members (circle_id, user_id, display_name_snapshot)
    values ('${circleId}', '${member.userId}', '${name}');
    insert into public.plan_participants (plan_id, revision, user_id)
    values ('${planId}', 1, '${member.userId}');
    commit;
  `);
  if (answered) {
    sql(`
      begin;
      select set_config('role', 'authenticated', true);
      select set_config('request.jwt.claims',
        '{"sub": "${member.userId}", "role": "authenticated", "is_anonymous": false}', true);
      select public.replace_response('${planId}', 1, 'flexible');
      commit;
    `);
  }
  const page = await (await browser.newContext()).newPage();
  await signedInAs(page, member.stored);
  return page;
}

test('a member whose times an edit cleared is told so, on the grid and on circle home (SUS-130)', async ({
  page,
  browser,
}) => {
  const maya = await asMaya(page);
  const circleId = circleOwnedBy(maya, 'Sunday Crew');
  const plan = planFor(circleId, maya);
  const nina = await memberOf(browser, circleId, plan.id, 'Nina', true);
  const jess = await memberOf(browser, circleId, plan.id, 'Jess', false);

  await page.goto(`/circles/${circleId}/plan/${plan.id}/edit`);
  await page.getByRole('checkbox', { name: 'Next 14 days' }).click();
  await page.getByRole('button', { name: 'Save and ask again' }).click();
  await expect(page.getByText('Ask Sunday Crew again.')).toBeVisible();
  expect(revisionOf(plan.id)).toBe(2);

  const changed = /^The plan changed, so the times you had painted/;
  const cleared =
    'The plan changed, so the times you sent were cleared. Add yours again so they count.';

  // Nina answered the first question, on no device this one has seen.
  await nina.goto(`/circles/${circleId}`);
  await expect(nina.getByText(cleared)).toBeVisible();
  // The card's button is the way to add them (review round 2).
  await nina.getByRole('button', { name: 'Add my times' }).click();
  await expect(nina).toHaveURL(new RegExp(`/j/${plan.code}$`));
  await expect(nina.getByText(changed)).toBeVisible();

  // Jess never answered: a revised plan is just a plan to her.
  await jess.goto(`/j/${plan.code}`);
  await expect(jess.getByText("Times I'd actually be up for")).toBeVisible();
  await expect(jess.getByText(changed)).toHaveCount(0);
  await jess.goto(`/circles/${circleId}`);
  await expect(jess.getByText('Finding a time')).toBeVisible();
  await expect(jess.getByText(cleared)).toHaveCount(0);
  await expect(jess.getByRole('button', { name: "See how it's looking" })).toBeVisible();

  // Once Nina answers the question as it is now, neither says it again.
  await nina.getByRole('switch', { name: "I'm easy" }).click();
  await nina.getByRole('button', { name: 'Send my times' }).click();
  await expect(nina).toHaveURL(new RegExp(`/j/${plan.code}/sent$`));
  await nina.goto(`/j/${plan.code}`);
  await expect(nina.getByText("Times I'd actually be up for")).toBeVisible();
  await expect(nina.getByText(changed)).toHaveCount(0);
  await nina.goto(`/circles/${circleId}`);
  await expect(nina.getByText('Finding a time')).toBeVisible();
  await expect(nina.getByText(cleared)).toHaveCount(0);
  await expect(nina.getByRole('button', { name: "See how it's looking" })).toBeVisible();
});

/**
 * The days on the calendar, in the month showing (SUS-133, ADR 0047). Next
 * month, so every day is ahead whatever the date the suite runs on.
 */
async function nextMonthsDays(page: Page) {
  await page.getByRole('button', { name: 'Later month' }).click();
  const grid = page.getByRole('group', { name: 'Days to ask about' });
  const buttons = grid.getByRole('button');
  await expect(buttons.first()).toBeVisible();
  const labels = await buttons.evaluateAll((all) => all.map((b) => b.getAttribute('aria-label')));
  // The first Monday, so Monday to Friday is one row of the grid.
  const monday = labels.findIndex((label) => label?.startsWith('Monday') === true);
  return { buttons, monday };
}

/** A sideways stroke with the mouse, from the middle of one day to the middle of another. */
async function strokeAcross(page: Page, from: Locator, to: Locator) {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
}

test('a plan with gaps: a run of days painted in one stroke, one more tapped, and a guest asked about only those', async ({
  page,
  browser,
}) => {
  const maya = await asMaya(page);
  const circleId = circleOwnedBy(maya, 'Sunday Crew');

  await page.goto(`/circles/${circleId}/plan/setup`);
  // The first "Custom" is the When chip; the second is the hours'.
  await page.getByRole('checkbox', { name: 'Custom' }).first().click();
  await expect(
    page.getByText('Tap the days you could meet, or drag across several.'),
  ).toBeVisible();

  const { buttons, monday } = await nextMonthsDays(page);
  await strokeAcross(page, buttons.nth(monday), buttons.nth(monday + 2));
  for (const index of [monday, monday + 1, monday + 2]) {
    await expect(buttons.nth(index)).toHaveAttribute('aria-pressed', 'true');
  }
  await expect(buttons.nth(monday + 3)).toHaveAttribute('aria-pressed', 'false');
  // Friday on its own, leaving Thursday out.
  await buttons.nth(monday + 4).click();
  await expect(buttons.nth(monday + 4)).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.getByText('4 days · the first and last can be up to 30 days apart'),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Use these dates' }).click();
  await page.getByRole('button', { name: 'Ask the group' }).click();
  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/plan/[^/]+/shared$`));

  const [plan] = plansIn(circleId);
  const [shape] = sql(`select window_end - window_start,
    (select count(*) from public.plan_days d where d.plan_id = p.id)
    from public.plans p where p.id = '${plan!.id}'`);
  expect(shape, 'Monday to Friday, four days asked').toEqual(['4', '4']);

  // A guest from the link sees those four days and no others, and answers one.
  const guest = await (await browser.newContext()).newPage();
  const scenario = { circleId, planId: plan!.id, planCode: plan!.code, ownerId: maya, secret: '' };
  const tom = await joinsAndAnswers(guest, scenario, 'Tom');
  const [answered] = sql(`select count(*) from public.willing_windows w
    join public.plan_responses r on r.id = w.response_id
    where r.plan_id = '${plan!.id}' and r.user_id = '${tom}'
      and (w.starts_at at time zone 'Australia/Melbourne')::date
        in (select day from public.plan_days where plan_id = '${plan!.id}')`);
  expect(answered).toEqual(['1']);
});

test('a mouse stroke that comes back to the day it began leaves that day picked', async ({
  page,
}) => {
  const maya = await asMaya(page);
  const circleId = circleOwnedBy(maya, 'Sunday Crew');
  await page.goto(`/circles/${circleId}/plan/setup`);
  await page.getByRole('checkbox', { name: 'Custom' }).first().click();
  const { buttons, monday } = await nextMonthsDays(page);

  // Monday to Tuesday and back: the release lands on Monday, whose click is
  // the stroke's and not a tap that would take it off again (review round 2).
  const a = (await buttons.nth(monday).boundingBox())!;
  const b = (await buttons.nth(monday + 1).boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2, { steps: 8 });
  await page.mouse.up();

  await expect(buttons.nth(monday)).toHaveAttribute('aria-pressed', 'true');
  await expect(buttons.nth(monday + 1)).toHaveAttribute('aria-pressed', 'false');
});

test('on a touch screen, a vertical drag over the calendar scrolls and a sideways one paints', async ({
  page,
}) => {
  test.skip(
    test.info().project.name !== 'android-chrome',
    'touch is dispatched through Chromium; iOS Safari is checked by hand',
  );
  const maya = await asMaya(page);
  const circleId = circleOwnedBy(maya, 'Sunday Crew');
  await page.goto(`/circles/${circleId}/plan/setup`);
  await page.getByRole('checkbox', { name: 'Custom' }).first().click();
  const { buttons, monday } = await nextMonthsDays(page);

  const cdp = await page.context().newCDPSession(page);
  const centre = async (index: number) => {
    const box = (await buttons.nth(index).boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const touchPath = async (points: { x: number; y: number }[]) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [points[0]!] });
    for (const point of points.slice(1)) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const steps = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Array.from({ length: 11 }, (_, i) => ({
      x: a.x + ((b.x - a.x) * i) / 10,
      y: a.y + ((b.y - a.y) * i) / 10,
    }));

  // Straight down through the weeks from the first Monday: a scroll.
  const start = await centre(monday);
  await touchPath(steps(start, { x: start.x, y: start.y + 140 }));
  await expect(page.locator('[aria-pressed="true"]')).toHaveCount(0);

  // Sideways from Monday to Wednesday: a stroke.
  await touchPath(steps(await centre(monday), await centre(monday + 2)));
  for (const index of [monday, monday + 1, monday + 2]) {
    await expect(buttons.nth(index)).toHaveAttribute('aria-pressed', 'true');
  }
});
