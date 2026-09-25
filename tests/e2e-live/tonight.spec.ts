import { expect, test, type Page } from './fixtures';
import { sendEvenings, signedInAs } from './journeys';

import { answerOf, circleOwnedBy, planFor, plansIn, signedInAccount, sql } from './stack';

/**
 * Tonight, end to end (S2-06, spec §5.3 and §5.5): the organiser picks
 * **Tonight** on the setup, the plan made is today alone with replies closing
 * within the hour, and the editor opens on its one day with **From now** and
 * **Later tonight**. Then **Use my usual times** (ADR 0005, ADR 00XX): after
 * two answers in a circle, a third plan offers them, and they paint without
 * sending.
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

  // The organiser's own answer: one day, already ticked, and tonight's two times.
  await page.goto(`/j/${plan!.code}`);
  await expect(page.getByText("Times I'd actually be up for")).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /^Later tonight/ })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /^Evening/ })).toHaveCount(0);
  await page.getByRole('checkbox', { name: /^From now/ }).click();
  await page.getByRole('button', { name: 'Send my times' }).click();
  await expect(page).toHaveURL(new RegExp(`/j/${plan!.code}/sent$`));
  expect(answerOf(plan!.id, mayaId)?.status).toBe('windows');
});

test('after two answers in a circle, the third plan offers the usual times and sends nothing', async ({
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
  await page.getByRole('button', { name: 'Use my usual times' }).click();
  await expect(
    page.getByRole('button', { name: /Adjust by the half hour$/ }).first(),
  ).toBeVisible();
  // Painted, not sent: Send is still the person's, and the button is gone.
  await expect(page.getByRole('button', { name: 'Use my usual times' })).toHaveCount(0);
  expect(answerOf(third.id, mayaId)).toBeUndefined();
});
