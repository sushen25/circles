import { expect, test, type Page } from './fixtures';

import { letterTo, lettersTo, linkIn, runDispatcher } from './mail';
import {
  accountToSignInTo,
  circleOwnedBy,
  guestWhoAnswered,
  planFor,
  sessionStorageKey,
  signedInAccount,
  sql,
  type Scenario,
} from './stack';

/**
 * Replies closed with no decision, end to end (spec §5.7, S2-05).
 *
 * The deadline passes with an option on offer and nothing locked in. The
 * organiser is told by email, opens the letter, and takes one of the ways out:
 * one more day — after which the extended deadline closes and is announced
 * again, which is the letter SUS-36 found the job layer swallowing — or a
 * hand-off to a member with a saved place, who is told in turn.
 */

const CLOSED = /^Sunday Crew: replies are closed$/;

async function signedInAs(page: Page, stored: string): Promise<void> {
  await page.addInitScript({
    content: `localStorage.setItem(${JSON.stringify(sessionStorageKey())}, ${JSON.stringify(stored)});`,
  });
}

function addressOf(userId: string): string {
  return sql(`select email from auth.users where id = '${userId}'`)[0]![0]!;
}

/**
 * Maya's plan with one option — next week's second evening, Maya and Tom —
 * and then its deadline gone. Both answers are the product's own
 * (`replace_response`), and the engine is the dispatcher's, run until the plan
 * is ready: a set written by hand is stale the moment anything bumps the
 * plan's input, and the sweep then recalculates it from the real answers
 * underneath the test. Tom is a guest; Priya has a saved place, and the plan
 * is asking her but she has not answered. `closed: false` leaves the deadline
 * for the test to pass itself.
 */
async function closedWithAnOption({ closed = true }: { closed?: boolean } = {}) {
  const maya = await signedInAccount('Maya');
  const circleId = circleOwnedBy(maya.userId, 'Sunday Crew');
  const plan = planFor(circleId, maya.userId);
  const crew: Scenario = {
    circleId,
    planId: plan.id,
    planCode: plan.code,
    ownerId: maya.userId,
    secret: '',
  };
  const priya = await accountToSignInTo('Priya');
  sql(`
    begin;
    insert into public.circle_members (circle_id, user_id, display_name_snapshot)
    values ('${circleId}', '${priya.userId}', 'Priya');
    insert into public.plan_participants (plan_id, revision, user_id)
    values ('${plan.id}', 1, '${priya.userId}');
    commit;
  `);
  const tom = guestWhoAnswered(crew, 'Tom');
  sql(`
    begin;
    select set_config('role', 'authenticated', true);
    select set_config('request.jwt.claims',
      '{"sub": "${maya.userId}", "role": "authenticated", "is_anonymous": false}', true);
    select public.replace_response('${plan.id}', 1, 'windows', jsonb_build_array(jsonb_build_object(
      'start', ((current_date + 8)::timestamp + interval '18 hours 30 minutes') at time zone 'Australia/Melbourne',
      'end', ((current_date + 8)::timestamp + interval '20 hours 30 minutes') at time zone 'Australia/Melbourne'
    )));
    commit;
  `);
  for (let attempt = 0; attempt < 20 && stateOf(plan.id) !== 'ready'; attempt += 1) {
    await runDispatcher();
  }
  expect(stateOf(plan.id)).toBe('ready');
  if (closed) {
    sql(
      `update public.plans set response_deadline = now() - interval '1 minute' where id = '${plan.id}'`,
    );
  }
  return { maya, circleId, plan, tom, priya };
}

function stateOf(planId: string): string {
  return sql(`select state from public.plans where id = '${planId}'`)[0]![0]!;
}

/**
 * Runs the dispatcher until the plan has `count` replies-closed jobs, then
 * sends any quiet hours are holding (SUS-91).
 *
 * `replies_closed` respects quiet hours (9 pm–8 am where the organiser is), so
 * a run of the suite in the Melbourne evening writes the job for the next
 * morning and no letter arrives: the spec failed, and a count of letters said
 * nothing either way. The jobs are the product's answer — written or not —
 * and they are what is asserted; the release only lets the letter be read.
 */
async function closingJobsFor(planId: string, count: number): Promise<number> {
  const jobs = () =>
    Number(
      sql(`select count(*) from jobs.notification_jobs
           where plan_id = '${planId}' and kind = 'replies_closed'`)[0]![0],
    );
  for (let attempt = 0; attempt < 20 && jobs() < count; attempt += 1) await runDispatcher();
  await releaseHeld(planId);
  return jobs();
}

async function closedLetters(address: string): Promise<number> {
  return (await lettersTo(address)).filter((letter) => CLOSED.test(letter.subject)).length;
}

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

/**
 * Priya's `replies_closed` jobs for the plan, by status, sorted. Live ones are
 * everything but `skipped`; the skipped ones carry why.
 */
function closingJobsToPriya(planId: string, priyaId: string): string[][] {
  return sql(`select j.status, coalesce(j.last_error, '') from jobs.notification_jobs j
              join private.email_contacts c on c.id = j.contact_id
              where j.plan_id = '${planId}' and j.kind = 'replies_closed'
                and c.user_id = '${priyaId}'
              order by j.status, j.last_error`);
}

/** Sends whatever quiet hours are holding for the plan (SUS-91). */
async function releaseHeld(planId: string): Promise<void> {
  sql(`update jobs.notification_jobs set scheduled_for = now()
       where plan_id = '${planId}' and status = 'scheduled'`);
  await runDispatcher();
}

/**
 * A zone where it is about two in the morning now, well inside quiet hours
 * (9 pm–8 am), whenever the suite runs. `Etc/GMT` signs are inverted:
 * `Etc/GMT-10` is ten hours ahead of UTC.
 */
function zoneAtTwoInTheMorning(): string {
  let ahead = (2 - new Date().getUTCHours() + 24) % 24;
  if (ahead > 12) ahead -= 24;
  if (ahead === 0) return 'Etc/UTC';
  return `Etc/GMT${ahead > 0 ? '-' : '+'}${Math.abs(ahead)}`;
}

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
