import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from './fixtures';

import {
  circleOwnedBy,
  guestInvited,
  lockInFirstOption,
  memberNamed,
  planFor,
  reentryTokenFor,
  sessionStorageKey,
  signedInAccount,
  sql,
  sundayCrew,
} from './stack';

/**
 * The morning after, end to end (spec §5.10, S1-29): the organiser reports
 * from the emailed link and from circle home, and a member who has lost their
 * session answers from the emailed way back in.
 *
 * The two acceptance criteria, each a test:
 * - "happened" updates circle home at once; "not sure" leaves it alone;
 * - a member arriving from the email with no session lands on the attendance
 *   screen after automatic reattachment.
 */

/**
 * A meetup locked in for next week with the plan's first option, then moved two
 * days back — the only way to reach the morning after without waiting for it.
 * Two days rather than one, so that nine the next morning (when the question
 * is brought up) has come whatever hour the suite runs at. The set and its one candidate are written the way `seed.sql` writes
 * Book Club's; the lock-in is `confirm_meetup` as the organiser.
 */
function happenedTheOtherNight(planId: string, organiserId: string, going: string[]): string {
  const setId = randomUUID();
  const ids = going.map((id) => `'${id}'`).join(', ');
  sql(`
    begin;
    insert into public.candidate_sets (
      id, plan_id, revision, input_version, scoring_version, input_hash,
      starts_considered, eligible_count, responded_count, active_member_count
    )
    select '${setId}', p.id, p.revision, p.input_version, p.scoring_version, 'e2e',
      1, ${going.length}, ${going.length}, ${going.length}
    from public.plans p where p.id = '${planId}';
    insert into public.candidates (
      candidate_set_id, is_near_miss, rank, starts_at, ends_at, available_user_ids,
      explicit_count, flexible_count, explanation_code, explanation_count
    ) values (
      '${setId}', false, 1,
      ((current_date + 8)::timestamp + interval '18 hours 30 minutes') at time zone 'Australia/Melbourne',
      ((current_date + 8)::timestamp + interval '20 hours 30 minutes') at time zone 'Australia/Melbourne',
      array[${ids}]::uuid[], ${going.length}, 0, 'best_attendance', ${going.length}
    );
    select planning.transition_plan('${planId}', 'candidates_ready', '${organiserId}');
    commit;
  `);
  lockInFirstOption(planId, organiserId);
  sql(`
    update public.meetup_confirmations
    set starts_at = now() - interval '50 hours', ends_at = now() - interval '48 hours'
    where plan_id = '${planId}' and status = 'active'
  `);
  return sql(
    `select id from public.meetup_confirmations where plan_id = '${planId}' and status = 'active'`,
  )[0]![0]!;
}

function lastMetAt(circleId: string): string {
  return sql(
    `select coalesce(last_met_at::text, 'never') from public.circles where id = '${circleId}'`,
  )[0]![0]!;
}

async function signedInAs(page: Page, stored: string): Promise<void> {
  await page.addInitScript({
    content: `localStorage.setItem(${JSON.stringify(sessionStorageKey())}, ${JSON.stringify(stored)});`,
  });
}

/** Maya's own circle, with Priya asked, and last night's meetup not yet reported. */
async function mayaTheMorningAfter() {
  const maya = await signedInAccount('Maya');
  const circleId = circleOwnedBy(maya.userId, 'Sunday Crew');
  const plan = planFor(circleId, maya.userId);
  const crew = { circleId, planId: plan.id, planCode: plan.code, ownerId: maya.userId, secret: '' };
  const priya = guestInvited(crew, 'Priya');
  const confirmationId = happenedTheOtherNight(plan.id, maya.userId, [maya.userId, priya]);
  return { maya, circleId, plan, priya, confirmationId };
}

test('"it happened", from the emailed link, is on circle home at once', async ({ page }) => {
  const { maya, circleId, plan, confirmationId } = await mayaTheMorningAfter();
  await signedInAs(page, maya.stored);

  // The organiser's "did it happen?" email's button.
  await page.goto(`/p/${plan.code}/outcome`);
  await expect(page.getByText(/^Did .+'s catch-up happen\?$/)).toBeVisible();
  const save = page.getByRole('button', { name: 'Save' });
  // Nothing is chosen for them: the answer is the metric.
  await expect(save).toHaveAttribute('aria-disabled', 'true');
  await page.getByRole('radio', { name: 'It happened' }).click();
  // The survey's second tap is its own (§5.10), and Save waits for it.
  await expect(save).toHaveAttribute('aria-disabled', 'true');
  await page.getByRole('checkbox', { name: 'No' }).click();
  await page.getByLabel("A line for the circle's record, optional").fill('Great night');
  await save.click();

  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}$`));
  expect(lastMetAt(circleId)).not.toBe('never');
  await expect(page.getByText('Not yet')).toHaveCount(0);
  // Answered, so not asked again.
  await expect(page.getByText(/^Did .+'s catch-up happen\?$/)).toHaveCount(0);
  expect(
    sql(
      `select outcome, note, moved_outside from public.outcome_reports where confirmation_id = '${confirmationId}'`,
    ),
  ).toEqual([['happened', 'Great night', 'f']]);
});

test('"not sure", from the card on circle home, leaves "last caught up" alone', async ({
  page,
}) => {
  const { maya, circleId, plan } = await mayaTheMorningAfter();
  await signedInAs(page, maya.stored);

  await page.goto(`/circles/${circleId}`);
  await expect(page.getByText(/^Did .+'s catch-up happen\?$/)).toBeVisible();
  await expect(page.getByText('Not yet')).toBeVisible();
  await page.getByRole('button', { name: 'Answer' }).click();
  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/plan/${plan.id}/outcome$`));

  await page.getByRole('radio', { name: 'Not sure' }).click();
  await page.getByRole('checkbox', { name: 'Yes' }).click();
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}$`));
  await expect(page.getByText('Not yet')).toBeVisible();
  await expect(page.getByText(/^Did .+'s catch-up happen\?$/)).toHaveCount(0);
  expect(lastMetAt(circleId)).toBe('never');
  expect(
    sql(
      `select outcome, moved_outside from public.outcome_reports o join public.meetup_confirmations c on c.id = o.confirmation_id where c.plan_id = '${plan.id}'`,
    ),
  ).toEqual([['not_sure', 't']]);
});

test('a member with no session, from the emailed way back in, lands on the question and answers it', async ({
  page,
}) => {
  const crew = sundayCrew();
  const tom = guestInvited(crew, 'Tom');
  happenedTheOtherNight(crew.planId, crew.ownerId, [crew.ownerId, tom]);
  const token = reentryTokenFor(crew, tom);

  await page.goto(`/a#${token}`);
  await expect(page).toHaveURL(new RegExp(`/p/${crew.planCode}/attendance$`));
  await expect(page.getByText(/^Did you make it to .+'s catch-up\?$/)).toBeVisible();
  await page.getByRole('button', { name: 'I was there' }).click();
  await expect(page.getByText('Thanks, noted.')).toBeVisible();

  // Reattached: Tom's place, under the identity this browser now holds.
  const now = memberNamed(crew.circleId, 'Tom');
  expect(now?.userId).not.toBe(tom);
  expect(
    sql(`
      select a.status from public.attendance a
      join public.meetup_confirmations c on c.id = a.confirmation_id
      where c.plan_id = '${crew.planId}' and a.user_id = '${now?.userId}'
    `),
  ).toEqual([['was_there']]);
});
