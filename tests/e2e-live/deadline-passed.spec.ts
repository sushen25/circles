import { expect, test } from './fixtures';

import { letterTo, lettersTo, linkIn, runDispatcher } from './mail';
import {
  CLOSED,
  addressOf,
  closedLetters,
  closedWithAnOption,
  closingJobsFor,
  closingJobsToPriya,
  releaseHeld,
  signedInAs,
  zoneAtTwoInTheMorning,
} from './replies-closed';
import { sql } from './stack';

/**
 * Replies closed with no decision, end to end (spec §5.7, S2-05).
 *
 * The deadline passes with an option on offer and nothing locked in. The
 * organiser is told by email, opens the letter, and takes one of the ways out:
 * one more day — after which the extended deadline closes and is announced
 * again, which is the letter SUS-36 found the job layer swallowing — or a
 * hand-off to a member with a saved place, who is told in turn — or the top
 * option, locked in. And a day later, still undecided, they are told once
 * more (ADR 0039).
 *
 * The plan and the counting are in `replies-closed.ts`.
 */

test('the organiser is told, gives it one more day, and is told again when that closes', async ({
  page,
  baseURL,
}) => {
  const { maya, plan } = await closedWithAnOption();
  const address = addressOf(maya.userId);
  await signedInAs(page, maya.stored);

  // Two ticks: the sweep announces the deadline, the next drain writes the
  // letter; quiet hours may hold it, so it is released before it is read.
  expect(await closingJobsFor(plan.id, 1)).toBe(1);
  const letter = await letterTo(address, CLOSED);
  await page.goto(linkIn(letter, new RegExp(`^/p/${plan.code}$`), baseURL!));

  await expect(page.getByText(/^Replies have closed\. .+ still works for two\.$/)).toBeVisible();
  await expect(page.getByText('Replies closed')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Lock in / })).toBeVisible();

  await page
    .getByRole('button', { name: /^Give it one more day\. Reopens replies until / })
    .click();

  // Replies are open again, so this is the options screen once more.
  await expect(page.getByText(/looks good for two of you\./)).toBeVisible();
  await expect(page.getByText(/^Closes /)).toBeVisible();
  expect(
    sql(`select deadline_extended_on_revision, response_deadline > now() + interval '23 hours'
         from public.plans where id = '${plan.id}'`),
  ).toEqual([['1', 't']]);

  // The extended deadline passes too, and it is announced: a second letter,
  // not a duplicate of the first.
  sql(
    `update public.plans set response_deadline = now() - interval '1 minute' where id = '${plan.id}'`,
  );
  expect(await closingJobsFor(plan.id, 2)).toBe(2);
  for (let attempt = 0; attempt < 20 && (await closedLetters(address)) < 2; attempt += 1) {
    await page.waitForTimeout(500);
  }
  expect(await closedLetters(address)).toBe(2);
  // And the two are two letters, both gone — not one sent and one swallowed.
  expect(
    sql(`select status from jobs.notification_jobs
         where plan_id = '${plan.id}' and kind = 'replies_closed' order by created_at`),
  ).toEqual([['sent'], ['sent']]);

  // And the day, once given, is not offered again.
  await page.reload();
  const again = page.getByRole('button', {
    name: 'Give it one more day. It has had its extra day already.',
  });
  await expect(again).toBeVisible();
  await expect(again).toHaveAttribute('aria-disabled', 'true');
});

test('the organiser hands it to a member with a saved place, never to a guest', async ({
  page,
}) => {
  const { maya, circleId, plan, priya } = await closedWithAnOption();
  await signedInAs(page, maya.stored);

  // The deadline's sweep announces it first, as it does within the minute on
  // a deployed project, and Maya opens the screen from that letter. Left to
  // chance, the sweep sometimes landed after the hand-off — whenever no other
  // test's dispatcher happened to run first — and by day that sends Priya a
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
  await page.getByRole('button', { name: 'Priya', exact: true }).click();
  await expect(page.getByText('Hand it to Priya?')).toBeVisible();
  await page.getByRole('button', { name: 'Hand it to Priya' }).click();

  // Maya is a member of it now, and sees it as one.
  await expect(page.getByText('Replies have closed. Priya picks one of these.')).toBeVisible();
  const change = page.getByRole('button', { name: 'Change my times' });
  await expect(change).toHaveAttribute('aria-disabled', 'true');
  expect(sql(`select organiser_user_id from public.plans where id = '${plan.id}'`)[0]![0]).toBe(
    priya.userId,
  );

  // Priya is told it is hers, with the letter that opens the three ways out.
  // It is written by the next drain, and held until morning in the evening,
  // so it is released before it is counted or read (SUS-91): one letter, gone.
  for (
    let attempt = 0;
    attempt < 20 && closingJobsToPriya(plan.id, priya.userId).length === 0;
    attempt += 1
  ) {
    await runDispatcher();
  }
  await releaseHeld(plan.id);
  expect(closingJobsToPriya(plan.id, priya.userId)).toEqual([['sent', '']]);
  await letterTo(priya.email, CLOSED);
  expect(await closedLetters(priya.email)).toBe(1);
});

test('a sweep that lands after the hand-off, overnight, replaces the letter rather than adding one', async () => {
  // Overnight for everybody, whenever this runs, so both letters are held.
  const { maya, plan, priya } = await closedWithAnOption({ closed: false });
  sql(`update public.profiles set time_zone = '${zoneAtTwoInTheMorning()}'
       where user_id in ('${maya.userId}', '${priya.userId}')`);

  // The deadline passes and Maya hands it over in one transaction, so no
  // dispatcher — this test's or another's — can sweep in between: the
  // deadline is announced after the hand-off, every time.
  sql(`
    begin;
    update public.plans set response_deadline = now() - interval '1 minute' where id = '${plan.id}';
    select set_config('role', 'authenticated', true);
    select set_config('request.jwt.claims',
      '{"sub": "${maya.userId}", "role": "authenticated", "is_anonymous": false}', true);
    select organiser_user_id from public.hand_off_organiser('${plan.id}', '${priya.userId}');
    commit;
  `);

  // One tick writes the hand-off's letter and sweeps; the next writes the
  // sweep's, which takes the place of the held one (`supersedeClosing`).
  for (
    let attempt = 0;
    attempt < 20 && closingJobsToPriya(plan.id, priya.userId).length < 2;
    attempt += 1
  ) {
    await runDispatcher();
  }
  expect(closingJobsToPriya(plan.id, priya.userId)).toEqual([
    ['scheduled', ''],
    ['skipped', 'superseded'],
  ]);

  // Morning: one letter reaches her.
  await releaseHeld(plan.id);
  expect(closingJobsToPriya(plan.id, priya.userId)).toEqual([
    ['sent', ''],
    ['skipped', 'superseded'],
  ]);
  await letterTo(priya.email, CLOSED);
  expect(await closedLetters(priya.email)).toBe(1);
});

test('the organiser locks in the top option from the replies-closed screen, through to Locked in', async ({
  page,
}) => {
  const { maya, circleId, plan } = await closedWithAnOption();
  await signedInAs(page, maya.stored);

  await page.goto(`/circles/${circleId}/plan/${plan.id}/deadline`);
  await expect(page.getByText(/^Replies have closed\. .+ still works for two\.$/)).toBeVisible();
  await page.getByRole('button', { name: /^Lock in / }).click();

  // ConfirmReview, as from the options: the place and the one question.
  await expect(page).toHaveURL(/\/review\?candidate=/);
  await expect(page.getByText('Lock it in?')).toBeVisible();
  await page.getByLabel('Where it is').fill('Hope St Radio');
  await page.getByRole('checkbox', { name: 'One person' }).click();
  await page.getByRole('button', { name: 'Lock it in' }).click();

  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/plan/${plan.id}/confirmed$`));
  await expect(page.getByText(/^Locked in: Sunday Crew, .* at Hope St Radio\./)).toBeVisible();
  expect(sql(`select state from public.plans where id = '${plan.id}'`)[0]![0]).toBe('confirmed');
});

test('still undecided a day on, the organiser is told once more, and only once', async ({
  page,
  baseURL,
}) => {
  test.skip(
    test.info().project.name !== 'android-chrome',
    'the dispatcher and the inbox, not the browser: the same in every project',
  );
  const { maya, plan } = await closedWithAnOption();
  const address = addressOf(maya.userId);
  expect(await closingJobsFor(plan.id, 1)).toBe(1);
  await letterTo(address, CLOSED);

  // A day later, as `240_replies_closed.sql` has it: the first announcement
  // is put back 25 hours, and the next sweep follows it up.
  sql(`update jobs.outbox set occurred_at = now() - interval '25 hours'
       where event_name = 'planning.deadline_passed' and aggregate_id = '${plan.id}'`);
  expect(await closingJobsFor(plan.id, 2)).toBe(2);
  for (let attempt = 0; attempt < 20 && (await closedLetters(address)) < 2; attempt += 1) {
    await page.waitForTimeout(500);
  }
  expect(await closedLetters(address)).toBe(2);
  expect(
    sql(`select count(*) from jobs.outbox where event_name = 'planning.deadline_passed'
         and aggregate_id = '${plan.id}' and payload ->> 'follow_up' = '+24h'`),
  ).toEqual([['1']]);

  // Once: the sweeps after it add nothing.
  await runDispatcher();
  await runDispatcher();
  expect(await closingJobsFor(plan.id, 2)).toBe(2);
  expect(await closedLetters(address)).toBe(2);

  // And the follow-up opens the same three ways out.
  const [newest] = await lettersTo(address);
  await signedInAs(page, maya.stored);
  await page.goto(linkIn(newest!, new RegExp(`^/p/${plan.code}$`), baseURL!));
  await expect(page.getByText(/^Replies have closed\. .+ still works for two\.$/)).toBeVisible();
});
