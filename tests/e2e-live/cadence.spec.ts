import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from './fixtures';
import { circleOwnedBy, sessionStorageKey, signedInAccount, sql } from './stack';

/**
 * The second meetup (spec §6.4, S2-04): a circle that has met is, a month on,
 * "About time for the next one"; the person the nudge asked is told it is
 * their turn; and **Plan another** asks the group again in one tap, with last
 * time's settings.
 *
 * The dispatcher's half — which circle is due, who is asked, one job per due
 * date, the send — is `230_cadence.sql` and `process-scheduled-jobs`'s own
 * tests. The prompt it would have written is written here directly, so that
 * this spec does not run the whole worker over every other spec's data.
 */

async function signIn(page: Page, stored: string): Promise<void> {
  await page.addInitScript({
    content: `localStorage.setItem(${JSON.stringify(sessionStorageKey())}, ${JSON.stringify(stored)});`,
  });
}

/**
 * Last time, as it would be after the morning after: a dinner over a week of
 * evenings, ninety minutes, at least two — a quorum Maya chose — twenty-six
 * days ago, reported as happened. `report_outcome` as Maya is what moves
 * `last_met_at` and completes the plan.
 */
function metTwentySixDaysAgo(circleId: string, mayaId: string, priyaId: string): void {
  const planId = randomUUID();
  const confirmationId = randomUUID();
  sql(`
    begin;
    insert into public.plans (
      id, circle_id, mode, state, organiser_user_id, title, category, time_zone,
      window_start, window_end, daily_start_local, daily_end_local,
      duration_minutes, quorum, quorum_source, response_deadline, short_code
    ) values (
      '${planId}', '${circleId}', 'named', 'confirmed', '${mayaId}', 'Dinner', 'dinner',
      'Australia/Melbourne', current_date - 29, current_date - 23, 1050, 1350, 90, 2, 'chosen',
      now() - interval '30 days', 'cdn${randomUUID()
        .replace(/[^a-hjkmnp-z2-9]/g, '')
        .slice(0, 7)}'
    );
    insert into public.plan_participants (plan_id, revision, user_id)
    values ('${planId}', 1, '${mayaId}'), ('${planId}', 1, '${priyaId}');
    insert into public.meetup_confirmations
      (id, plan_id, revision, candidate_id, starts_at, ends_at, available_user_ids, confirmed_by)
    values ('${confirmationId}', '${planId}', 1, 'e2e', now() - interval '26 days',
      now() - interval '26 days' + interval '90 minutes',
      array['${mayaId}', '${priyaId}']::uuid[], '${mayaId}');
    insert into public.attendance (confirmation_id, user_id, status)
    values ('${confirmationId}', '${mayaId}', 'going'), ('${confirmationId}', '${priyaId}', 'going');
    select set_config('role', 'authenticated', true);
    select set_config('request.jwt.claims', '{"sub": "${mayaId}", "role": "authenticated"}', true);
    select public.report_outcome('${confirmationId}', 'happened');
    commit;
  `);
}

test('a circle a month on from its last meetup asks one person, and Plan another is one tap with last time’s settings', async ({
  page,
}) => {
  const maya = await signedInAccount('Maya');
  const priya = await signedInAccount('Priya');
  const circleId = circleOwnedBy(maya.userId, 'Sunday Crew');
  sql(`insert into public.circle_members (circle_id, user_id, display_name_snapshot)
    values ('${circleId}', '${priya.userId}', 'Priya')`);
  metTwentySixDaysAgo(circleId, maya.userId, priya.userId);
  // The dispatcher's decision for this cycle: Maya was asked.
  sql(`insert into private.cadence_prompts (circle_id, last_met_at, due_date, user_id, recipient_role)
    select id, last_met_at, current_date + 5, '${maya.userId}', 'owner'
    from public.circles where id = '${circleId}'`);

  await signIn(page, maya.stored);
  await page.goto(`/circles/${circleId}`);
  await expect(page.getByText('About time for the next one')).toBeVisible();
  await expect(
    page.getByText(/It's your turn to plan, if the group's keen\. No rush\./),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Snooze a month' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Turn off nudges' })).toBeVisible();

  await page.getByRole('button', { name: 'Plan another' }).click();
  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/plan/another$`));
  await expect(
    page.getByText(/^Filled in from .+'s catch-up\. Change anything you like\.$/),
  ).toBeVisible();

  // One tap.
  await page.getByRole('button', { name: 'Ask the group' }).click();
  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/plan/[^/]+/shared$`));

  const [made] = sql(`
    select category, duration_minutes, quorum, quorum_source, window_end - window_start + 1
    from public.plans where circle_id = '${circleId}' and state = 'collecting'
  `);
  expect(made).toEqual(['dinner', '90', '2', 'chosen', '7']);
});

test('a member who is not the one asked reads the quieter card, and can turn their own nudges off', async ({
  page,
}) => {
  const maya = await signedInAccount('Maya');
  const priya = await signedInAccount('Priya');
  const circleId = circleOwnedBy(maya.userId, 'Sunday Crew');
  sql(`insert into public.circle_members (circle_id, user_id, display_name_snapshot)
    values ('${circleId}', '${priya.userId}', 'Priya')`);
  metTwentySixDaysAgo(circleId, maya.userId, priya.userId);
  sql(`insert into private.cadence_prompts (circle_id, last_met_at, due_date, user_id, recipient_role)
    select id, last_met_at, current_date + 5, '${maya.userId}', 'owner'
    from public.circles where id = '${circleId}'`);

  await signIn(page, priya.stored);
  await page.goto(`/circles/${circleId}`);
  await expect(page.getByText(/Plan the next one when the group's keen\. No rush\./)).toBeVisible();
  await expect(page.getByText(/your turn/)).toHaveCount(0);
  // Snoozing is the circle's setting, and the owner's.
  await expect(page.getByRole('button', { name: 'Snooze a month' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Turn off nudges' }).click();
  await expect(
    page.getByText("You won't be asked to plan the next one in Sunday Crew.", { exact: false }),
  ).toBeVisible();
  expect(
    sql(`select muted_nudges from public.circle_members
      where circle_id = '${circleId}' and user_id = '${priya.userId}'`),
  ).toEqual([['t']]);
});
