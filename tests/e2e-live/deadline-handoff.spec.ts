// @e2e: core
import { expect, test } from './fixtures';

import { letterTo, runDispatcher } from './mail';
import {
  CLOSED,
  closedLetters,
  closedWithAnOption,
  closingJobsToNina,
  drainedTheSweep,
  handedOffInTheSameBreathAsTheDeadline,
  releaseHeld,
  signedInAs,
  zoneAtNoon,
  zoneAtTwoInTheMorning,
} from './replies-closed';
import { sql } from './stack';

/**
 * Handing a plan on once its replies have closed (spec §5.7, S2-05, SUS-96).
 *
 * Split out of `deadline-passed.spec.ts`, which is about the organiser's own
 * ways out. Here the plan changes hands, and the new organiser is told once.
 * The plan and the counting are in `replies-closed.ts`.
 */

test('the organiser hands it to a member with a saved place, never to a guest', async ({
  page,
}) => {
  const { maya, circleId, plan, nina } = await closedWithAnOption();
  await signedInAs(page, maya.stored);

  // The deadline's sweep announces it first, as it does within the minute on
  // a deployed project, and Maya opens the screen from that letter. Left to
  // chance, the sweep sometimes landed after the hand-off — whenever no other
  // test's dispatcher happened to run first — and by day that sends Nina a
  // second letter after the first has gone (SUS-95; the product half is
  // SUS-96). That order is pinned in the test below instead.
  const announced = () =>
    sql(`select count(*) from jobs.notification_jobs
         where plan_id = '${plan.id}' and kind = 'replies_closed'`)[0]![0];
  for (let attempt = 0; attempt < 20 && announced() === '0'; attempt += 1) await runDispatcher();
  expect(announced()).toBe('1');

  await page.goto(`/circles/${circleId}/plan/${plan.id}/deadline`);
  await page.getByRole('button', { name: /^Hand this to someone else/ }).click();

  const tom = page.getByRole('button', { name: 'Tom. Needs a saved place' });
  await expect(tom).toBeVisible();
  await expect(tom).toHaveAttribute('aria-disabled', 'true');
  await page.getByRole('button', { name: 'Nina', exact: true }).click();
  await expect(page.getByText('Hand it to Nina?')).toBeVisible();
  await page.getByRole('button', { name: 'Hand it to Nina' }).click();

  // Maya is a member of it now, and sees it as one.
  await expect(page.getByText('Replies have closed. Nina picks one of these.')).toBeVisible();
  const change = page.getByRole('button', { name: 'Change my times' });
  await expect(change).toHaveAttribute('aria-disabled', 'true');
  expect(sql(`select organiser_user_id from public.plans where id = '${plan.id}'`)[0]![0]).toBe(
    nina.userId,
  );

  // Nina is told it is hers, with the letter that opens the three ways out.
  // It is written by the next drain, and held until morning in the evening,
  // so it is released before it is counted or read (SUS-91): one letter, gone.
  for (
    let attempt = 0;
    attempt < 20 && closingJobsToNina(plan.id, nina.userId).length === 0;
    attempt += 1
  ) {
    await runDispatcher();
  }
  await releaseHeld(plan.id);
  expect(closingJobsToNina(plan.id, nina.userId)).toEqual([['sent', '']]);
  await letterTo(nina.email, CLOSED);
  expect(await closedLetters(nina.email)).toBe(1);
});

// The dispatcher drains before it sweeps, so a plan handed on after its
// deadline but before the sweep announced it tells the new organiser first, and
// the sweep's own letter would be a second one to the same person (SUS-96). It
// is written both ways, by day, when the first has gone before the second is
// written, and overnight, when both would be held. Each was red before the drain
// declined the sweep's letter (`coveredByHandOff`).
test('by day, a sweep that lands after the hand-off sends one letter, not two', async () => {
  const { plan, nina } = await handedOffInTheSameBreathAsTheDeadline(zoneAtNoon());

  // One tick writes (and, by day, sends) the hand-off's letter and sweeps; the
  // next drains the sweep.
  await drainedTheSweep(plan.id);
  expect(closingJobsToNina(plan.id, nina.userId)).toEqual([['sent', '']]);
  await letterTo(nina.email, CLOSED);
  expect(await closedLetters(nina.email)).toBe(1);
});

test('overnight, a sweep that lands after the hand-off adds nothing to the held letter', async () => {
  const { plan, nina } = await handedOffInTheSameBreathAsTheDeadline(zoneAtTwoInTheMorning());

  await drainedTheSweep(plan.id);
  expect(closingJobsToNina(plan.id, nina.userId)).toEqual([['scheduled', '']]);

  // Morning: one letter reaches her.
  await releaseHeld(plan.id);
  expect(closingJobsToNina(plan.id, nina.userId)).toEqual([['sent', '']]);
  await letterTo(nina.email, CLOSED);
  expect(await closedLetters(nina.email)).toBe(1);
});
