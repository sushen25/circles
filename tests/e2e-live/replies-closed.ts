import { expect, type Page } from './fixtures';
import { lettersTo, runDispatcher } from './mail';
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
 * The plans, letters and jobs of `deadline-passed.spec.ts` (S2-05, S2-08):
 * a plan whose replies have closed with an option on offer, and the ways to
 * count what the dispatcher wrote and sent about it. Moved out of the spec
 * unchanged when S2-08 added its tests, to keep the spec about its journeys.
 */

export const CLOSED = /^Sunday Crew: replies are closed$/;

export async function signedInAs(page: Page, stored: string): Promise<void> {
  await page.addInitScript({
    content: `localStorage.setItem(${JSON.stringify(sessionStorageKey())}, ${JSON.stringify(stored)});`,
  });
}

export function addressOf(userId: string): string {
  return sql(`select email from auth.users where id = '${userId}'`)[0]![0]!;
}

/**
 * Maya's plan with one option — next week's second evening, Maya and Tom —
 * and then its deadline gone. Both answers are the product's own
 * (`replace_response`), and the engine is the dispatcher's, run until the plan
 * is ready: a set written by hand is stale the moment anything bumps the
 * plan's input, and the sweep then recalculates it from the real answers
 * underneath the test. Tom is a guest; Nina has a saved place, and the plan
 * is asking her but she has not answered. `closed: false` leaves the deadline
 * for the test to pass itself.
 */
export async function closedWithAnOption({ closed = true }: { closed?: boolean } = {}) {
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
  const nina = await accountToSignInTo('Nina');
  sql(`
    begin;
    insert into public.circle_members (circle_id, user_id, display_name_snapshot)
    values ('${circleId}', '${nina.userId}', 'Nina');
    insert into public.plan_participants (plan_id, revision, user_id)
    values ('${plan.id}', 1, '${nina.userId}');
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
  return { maya, circleId, plan, tom, nina };
}

export function stateOf(planId: string): string {
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
export async function closingJobsFor(planId: string, count: number): Promise<number> {
  const jobs = () =>
    Number(
      sql(`select count(*) from jobs.notification_jobs
           where plan_id = '${planId}' and kind = 'replies_closed'`)[0]![0],
    );
  for (let attempt = 0; attempt < 20 && jobs() < count; attempt += 1) await runDispatcher();
  await releaseHeld(planId);
  return jobs();
}

export async function closedLetters(address: string): Promise<number> {
  return (await lettersTo(address)).filter((letter) => CLOSED.test(letter.subject)).length;
}

/**
 * Nina's `replies_closed` jobs for the plan, by status, sorted. Live ones are
 * everything but `skipped`; the skipped ones carry why.
 */
export function closingJobsToNina(planId: string, ninaId: string): string[][] {
  return sql(`select j.status, coalesce(j.last_error, '') from jobs.notification_jobs j
              join private.email_contacts c on c.id = j.contact_id
              where j.plan_id = '${planId}' and j.kind = 'replies_closed'
                and c.user_id = '${ninaId}'
              order by j.status, j.last_error`);
}

/** Sends whatever quiet hours are holding for the plan (SUS-91). */
export async function releaseHeld(planId: string): Promise<void> {
  sql(`update jobs.notification_jobs set scheduled_for = now()
       where plan_id = '${planId}' and status = 'scheduled'`);
  await runDispatcher();
}

/**
 * A zone where it is `hour` o'clock now, whenever the suite runs. `Etc/GMT`
 * signs are inverted: `Etc/GMT-10` is ten hours ahead of UTC.
 */
function zoneAtHour(hour: number): string {
  let ahead = (hour - new Date().getUTCHours() + 24) % 24;
  if (ahead > 12) ahead -= 24;
  if (ahead === 0) return 'Etc/UTC';
  return `Etc/GMT${ahead > 0 ? '-' : '+'}${Math.abs(ahead)}`;
}

/** About two in the morning, well inside quiet hours (9 pm-8 am): letters are held. */
export function zoneAtTwoInTheMorning(): string {
  return zoneAtHour(2);
}

/**
 * A zone where it is about noon now, well outside quiet hours (9 pm–8 am),
 * whenever the suite runs (SUS-216). The live users are made in
 * `Australia/Melbourne`, which is in quiet hours from 10:00 to 21:00 UTC, so a
 * test that waits for an account-holder's letter would be held overnight for
 * eleven hours a day. The send path is the real one; only the recipient's
 * clock is chosen. Same `Etc/GMT` sign rule as `zoneAtTwoInTheMorning`.
 */
export function zoneAtNoon(): string {
  return zoneAtHour(12);
}

/**
 * Runs the dispatcher until the sweep's `deadline_passed` for the plan has been
 * drained, which is the tick after it was emitted. After it, every letter
 * either path will write has been written.
 */
export async function drainedTheSweep(planId: string): Promise<void> {
  const drained = () =>
    sql(`select count(*) from jobs.outbox
         where event_name = 'planning.deadline_passed' and aggregate_id = '${planId}'
           and processed_at is not null`)[0]![0] !== '0';
  for (let attempt = 0; attempt < 20 && !drained(); attempt += 1) await runDispatcher();
  expect(drained()).toBe(true);
}

/**
 * Maya's plan, a minute past its deadline, and the hand-off to Nina, in one
 * transaction: no dispatcher, this test's or another's, can sweep in between,
 * so the deadline is announced after the hand-off every time. Both of them are
 * put in `zone` first, so a test says whether the letters are held.
 */
export async function handedOffInTheSameBreathAsTheDeadline(zone: string) {
  const { maya, plan, nina } = await closedWithAnOption({ closed: false });
  sql(`update public.profiles set time_zone = '${zone}'
       where user_id in ('${maya.userId}', '${nina.userId}')`);
  sql(`
    begin;
    update public.plans set response_deadline = now() - interval '1 minute' where id = '${plan.id}';
    select set_config('role', 'authenticated', true);
    select set_config('request.jwt.claims',
      '{"sub": "${maya.userId}", "role": "authenticated", "is_anonymous": false}', true);
    select organiser_user_id from public.hand_off_organiser('${plan.id}', '${nina.userId}');
    commit;
  `);
  return { maya, plan, nina };
}

/**
 * Puts these account-holders where it is daytime now, so a letter to them is
 * sent, not held (SUS-91, SUS-216). Their circle stays in Melbourne, so the
 * times the page prints do not move.
 */
export function awakeNow(...userIds: string[]): void {
  const list = userIds.map((id) => `'${id}'`).join(', ');
  sql(`update public.profiles set time_zone = '${zoneAtNoon()}' where user_id in (${list})`);
}
