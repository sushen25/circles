import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from './fixtures';
import { letterTo, linkIn, runDispatcher } from './mail';
import { circleOwnedBy, sessionStorageKey, signedInAccount, sql } from './stack';

/**
 * The second meetup (spec §6.4, S2-04): a circle that has met is, a month on,
 * "About time for the next one"; the person the nudge asked is told it is
 * their turn; and **Plan another** asks the group again in one tap, with last
 * time's settings.
 *
 * The dispatcher's half — which circle is due, who is asked, one decision per
 * cycle, the send — is `230_cadence.sql` and `process-scheduled-jobs`'s own
 * tests. The first two tests write the prompt it would have written directly,
 * because they are about the screens. The last (S2-08) runs the worker, which
 * sweeps the whole stack, so it asserts only about its own circle: a circle
 * that met before the due date it was asked about starts a new cycle, the
 * sweep asks the next person, and the letter reaches them.
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
  sql(`begin; ${metSql(circleId, mayaId, [mayaId, priyaId], 26)} commit;`);
}

/**
 * A dinner `organiserId` organised, `daysAgo`, that `attendees` went to,
 * reported as happened by the organiser — as SQL, to run inside a
 * transaction of the caller's, which it leaves acting as `postgres` again.
 */
function metSql(circleId: string, organiserId: string, attendees: string[], daysAgo: number) {
  const planId = randomUUID();
  const confirmationId = randomUUID();
  const ids = attendees.map((id) => `'${id}'`);
  return `
    insert into public.plans (
      id, circle_id, mode, state, organiser_user_id, title, category, time_zone,
      window_start, window_end, daily_start_local, daily_end_local,
      duration_minutes, quorum, quorum_source, response_deadline, short_code
    ) values (
      '${planId}', '${circleId}', 'named', 'confirmed', '${organiserId}', 'Dinner', 'dinner',
      'Australia/Melbourne', current_date - ${daysAgo + 3}, current_date - ${daysAgo - 3}, 1050, 1350,
      90, 2, 'chosen', now() - interval '${daysAgo + 4} days', 'cdn${randomUUID()
        .replace(/[^a-hjkmnp-z2-9]/g, '')
        .slice(0, 7)}'
    );
    insert into public.plan_participants (plan_id, revision, user_id)
    select '${planId}', 1, unnest(array[${ids.join(', ')}]::uuid[]);
    insert into public.meetup_confirmations
      (id, plan_id, revision, candidate_id, starts_at, ends_at, available_user_ids, confirmed_by)
    values ('${confirmationId}', '${planId}', 1, 'e2e', now() - interval '${daysAgo} days',
      now() - interval '${daysAgo} days' + interval '90 minutes',
      array[${ids.join(', ')}]::uuid[], '${organiserId}');
    insert into public.attendance (confirmation_id, user_id, status)
    select '${confirmationId}', unnest(array[${ids.join(', ')}]::uuid[]), 'going';
    select set_config('role', 'authenticated', true);
    select set_config('request.jwt.claims', '{"sub": "${organiserId}", "role": "authenticated"}', true);
    select public.report_outcome('${confirmationId}', 'happened');
    select set_config('role', 'postgres', true);
    select set_config('request.jwt.claims', '', true);
  `;
}

/**
 * The dispatcher's decision for this cycle, as it would have written it.
 *
 * An upsert, because the dispatcher may get there first: every spec that runs
 * it sweeps the whole stack, and a circle a month on is due. It would choose
 * the same person, but the row is made to say exactly what the test needs.
 */
function promptedThisCycle(circleId: string, userId: string, role: string, due: string): string {
  return `insert into private.cadence_prompts (circle_id, last_met_at, due_date, user_id, recipient_role)
    select id, last_met_at, ${due}, '${userId}', '${role}' from public.circles where id = '${circleId}'
    on conflict (circle_id, last_met_at) do update
      set due_date = excluded.due_date, user_id = excluded.user_id,
          recipient_role = excluded.recipient_role;`;
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
  sql(promptedThisCycle(circleId, maya.userId, 'owner', 'current_date + 5'));

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
  sql(promptedThisCycle(circleId, maya.userId, 'owner', 'current_date + 5'));

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

test('swept by the dispatcher: a circle that met before its due date is a new cycle, and the turn passes on, by email', async ({
  browser,
  baseURL,
}) => {
  test.skip(
    test.info().project.name !== 'android-chrome',
    'the dispatcher and the inbox, not the browser: the same in every project',
  );
  const [maya, priya, tom, jess] = await Promise.all(
    ['Maya', 'Priya', 'Tom', 'Jess'].map((name) => signedInAccount(name)),
  );
  const circleId = circleOwnedBy(maya!.userId, 'Sunday Crew');
  // Four, so the circle takes turns; joined in this order, which is the
  // order the turn walks.
  sql(`
    update public.circle_members set joined_at = now() - interval '90 days'
    where circle_id = '${circleId}' and user_id = '${maya!.userId}';
    insert into public.circle_members (circle_id, user_id, display_name_snapshot, joined_at) values
      ('${circleId}', '${priya!.userId}', 'Priya', now() - interval '89 days'),
      ('${circleId}', '${tom!.userId}', 'Tom', now() - interval '88 days'),
      ('${circleId}', '${jess!.userId}', 'Jess', now() - interval '87 days');
  `);

  // Last cycle: Maya organised, Maya and Priya went, and the turn after
  // Maya's was Priya's — decided in the same breath, so no sweep can be first.
  sql(`begin;
    ${metSql(circleId, maya!.userId, [maya!.userId, priya!.userId], 50)}
    ${promptedThisCycle(circleId, priya!.userId, 'take_turns', 'current_date - 20')}
    commit;`);
  const priyas = await (await browser.newContext()).newPage();
  await signIn(priyas, priya!.stored);
  await priyas.goto(`/circles/${circleId}`);
  await expect(priyas.getByText(/It's your turn to plan/)).toBeVisible();

  // Before that due date came, they met again: Priya organised, and Maya,
  // Priya and Tom went. A new cycle, so last cycle's turn is nobody's now.
  sql(`begin;
    ${metSql(circleId, priya!.userId, [maya!.userId, priya!.userId, tom!.userId], 26)}
    commit;`);
  await priyas.reload();
  await expect(priyas.getByText('About time for the next one')).toBeVisible();
  await expect(priyas.getByText(/your turn/)).toHaveCount(0);

  // A month on from that, the sweep decides the new cycle: after Priya, Tom.
  const decided = () =>
    sql(`select p.user_id, p.recipient_role from private.cadence_prompts p
         join public.circles c on c.id = p.circle_id and c.last_met_at = p.last_met_at
         where p.circle_id = '${circleId}'`);
  for (let attempt = 0; attempt < 20 && decided().length === 0; attempt += 1) {
    await runDispatcher();
  }
  expect(decided()).toEqual([[tom!.userId, 'take_turns']]);
  expect(
    sql(`select count(*) from private.cadence_prompts where circle_id = '${circleId}'`),
  ).toEqual([['2']]);

  // One letter, to Tom; held overnight, so released before it is read (SUS-91).
  sql(`update jobs.notification_jobs set scheduled_for = now()
       where circle_id = '${circleId}' and kind = 'about_time' and status = 'scheduled'`);
  const address = sql(`select email from auth.users where id = '${tom!.userId}'`)[0]![0]!;
  const letter = await letterTo(address, /^Sunday Crew: about time\?$/);
  expect(letter.text).toMatch(/Your turn to plan, if you're keen\. No rush\./);

  const toms = await (await browser.newContext()).newPage();
  await signIn(toms, tom!.stored);
  await toms.goto(linkIn(letter, new RegExp(`^/circles/${circleId}`), baseURL!));
  await expect(
    toms.getByText(/It's your turn to plan, if the group's keen\. No rush\./),
  ).toBeVisible();
  await priyas.reload();
  await expect(
    priyas.getByText(/Plan the next one when the group's keen\. No rush\./),
  ).toBeVisible();
  await expect(priyas.getByText(/your turn/)).toHaveCount(0);
});
