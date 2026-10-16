// @e2e: core
import { expect, test, type Page } from './fixtures';
import { joinsAndAnswers, sendEvenings, signedInAs } from './journeys';

import {
  answerOf,
  circleOwnedBy,
  planFor,
  planStopsAsking,
  plansIn,
  signedInAccount,
  sql,
  sundayCrew,
} from './stack';

/**
 * Tonight, end to end (S2-06, spec §5.3 and §5.5): the organiser picks
 * **Tonight** on the setup, the plan made is today alone with replies closing
 * within the hour, and the editor opens on its one day with **From now** and
 * **Later tonight**. Then an answer never given (ADR 0077, over ADR 0068 and
 * ADR 0037): whatever the person answered before in the circle, the next plan
 * opens with no day tapped and sends nothing until the person does.
 *
 * Tonight is on the clock, so the circle is put in a zone where it is early
 * afternoon now — whatever hour the suite runs at, tonight is on offer. The
 * `Etc/GMT` zones have the sign the other way round: `Etc/GMT-3` is UTC+3.
 */
function zoneWhereItIsAfternoon(): string {
  // 13 - hour, brought into -11 … +12.
  const offset = ((72 - new Date().getUTCHours()) % 24) - 11;
  if (offset === 0) return 'Etc/GMT';
  return offset > 0 ? `Etc/GMT-${offset}` : `Etc/GMT+${-offset}`;
}

async function asMaya(page: Page): Promise<string> {
  const maya = await signedInAccount('Maya');
  await signedInAs(page, maya.stored);
  return maya.userId;
}

test('an organiser asks about tonight, and the editor asks about tonight', async ({ page }) => {
  const mayaId = await asMaya(page);
  const circleId = circleOwnedBy(mayaId, 'Sunday Crew');
  const zone = zoneWhereItIsAfternoon();
  sql(`update public.circles set time_zone = '${zone}' where id = '${circleId}'`);

  await page.goto(`/circles/${circleId}/plan/setup`);
  await page.getByLabel('Tonight', { exact: true }).click();
  await expect(page.getByText(/^Replies close in (60|[1-5]\d) minutes$/)).toBeVisible();
  await page.getByRole('button', { name: 'Ask the group' }).click();
  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/plan/[^/]+/shared$`));

  // Today alone, in the circle's zone, with replies closing within the hour.
  const [plan] = plansIn(circleId);
  const [row] = sql(`
    select window_start = window_end,
      window_start = (now() at time zone '${zone}')::date,
      extract(epoch from response_deadline - now()) <= 3600
    from public.plans where id = '${plan!.id}'`);
  expect(row).toEqual(['t', 't', 't']);

  // The organiser's own answer: one day to tap, and tonight's two times behind
  // Change time, From now first.
  await page.goto(`/j/${plan!.code}`);
  await expect(page.getByText('Which days could work?')).toBeVisible();
  const today = page.getByRole('group', { name: 'Days in this plan' }).getByRole('button');
  await today.click();
  await expect(page.getByText(/^From now, from /)).toBeVisible();
  await page.getByRole('button', { name: /^Change the time for/ }).click();
  await expect(page.getByRole('radio', { name: /^From now/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.getByRole('radio', { name: /^Later tonight/ })).toBeVisible();
  await expect(page.getByRole('radio', { name: /^Evening/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Send my times' }).click();
  await expect(page).toHaveURL(new RegExp(`/j/${plan!.code}/sent$`));
  expect(answerOf(plan!.id, mayaId)?.status).toBe('windows');
});

/** The days the person has tapped. */
const tapped = (page: Page) =>
  page.getByRole('group', { name: 'Days in this plan' }).getByRole('button', { pressed: true });

test('a returning guest opens a new plan with nothing tapped, and sends only what they tap', async ({
  page,
}) => {
  const crew = sundayCrew();
  const ren = await joinsAndAnswers(page, crew, 'Ren');
  expect(answerOf(crew.planId, ren)?.status).toBe('windows');
  // One answer with times, in a circle whose next plan has not been asked yet.
  planStopsAsking(crew, 'cancelled');

  const second = planFor(crew.circleId, crew.ownerId);
  await page.goto(`/j/${second.code}`);
  await expect(page.getByText('Which evenings could work?')).toBeVisible();
  // Let anything that was going to tap a day do it before looking.
  await page.waitForLoadState('networkidle');
  await expect(tapped(page)).toHaveCount(0);
  await expect(page.getByText('Evenings, from 5:30 pm')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Send my times' })).toBeDisabled();
  expect(answerOf(second.id, ren)).toBeUndefined();

  const day = page.getByRole('group', { name: 'Days in this plan' }).getByRole('button').nth(1);
  await day.click();
  await expect(tapped(page)).toHaveCount(1);
  await page.getByRole('button', { name: 'Send my times' }).click();
  await expect(page).toHaveURL(new RegExp(`/j/${second.code}/sent$`));
  expect(answerOf(second.id, ren)?.status).toBe('windows');
});

test('after several answers in a circle, the next plan still opens with nothing tapped', async ({
  page,
}) => {
  const mayaId = await asMaya(page);
  const circleId = circleOwnedBy(mayaId, 'Sunday Crew');

  // Two plans answered through the editor, each called off before the next
  // (one open plan per circle, ADR 0033).
  for (let i = 0; i < 2; i += 1) {
    const earlier = planFor(circleId, mayaId);
    await page.goto(`/j/${earlier.code}`);
    await sendEvenings(page, earlier.code, 1, 2);
    sql(`select planning.transition_plan('${earlier.id}', 'cancel', '${mayaId}')`);
  }

  const third = planFor(circleId, mayaId);
  await page.goto(`/j/${third.code}`);
  await expect(page.getByText('Which evenings could work?')).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect(tapped(page)).toHaveCount(0);
  expect(answerOf(third.id, mayaId)).toBeUndefined();
  // And the word on no screen.
  await expect(page.getByText(/usual/i)).toHaveCount(0);
});
