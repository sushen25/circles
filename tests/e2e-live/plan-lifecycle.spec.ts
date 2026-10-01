import { expect, test, type Browser, type Page } from './fixtures';
import { signedInAs } from './journeys';
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
  const priya = await memberOf(browser, circleId, plan.id, 'Priya', true);
  const jess = await memberOf(browser, circleId, plan.id, 'Jess', false);

  await page.goto(`/circles/${circleId}/plan/${plan.id}/edit`);
  await page.getByRole('checkbox', { name: 'Next 14 days' }).click();
  await page.getByRole('button', { name: 'Save and ask again' }).click();
  await expect(page.getByText('Ask Sunday Crew again.')).toBeVisible();
  expect(revisionOf(plan.id)).toBe(2);

  const changed = /^The plan changed, so the times you had painted/;
  const cleared =
    'The plan changed, so the times you sent were cleared. Add yours again so they count.';

  // Priya answered the first question, on no device this one has seen.
  await priya.goto(`/circles/${circleId}`);
  await expect(priya.getByText(cleared)).toBeVisible();
  // The card's button is the way to add them (review round 2).
  await priya.getByRole('button', { name: 'Add my times' }).click();
  await expect(priya).toHaveURL(new RegExp(`/j/${plan.code}$`));
  await expect(priya.getByText(changed)).toBeVisible();

  // Jess never answered: a revised plan is just a plan to her.
  await jess.goto(`/j/${plan.code}`);
  await expect(jess.getByText("Times I'd actually be up for")).toBeVisible();
  await expect(jess.getByText(changed)).toHaveCount(0);
  await jess.goto(`/circles/${circleId}`);
  await expect(jess.getByText('Finding a time')).toBeVisible();
  await expect(jess.getByText(cleared)).toHaveCount(0);
  await expect(jess.getByRole('button', { name: "See how it's looking" })).toBeVisible();

  // Once Priya answers the question as it is now, neither says it again.
  await priya.getByRole('switch', { name: "I'm easy" }).click();
  await priya.getByRole('button', { name: 'Send my times' }).click();
  await expect(priya).toHaveURL(new RegExp(`/j/${plan.code}/sent$`));
  await priya.goto(`/j/${plan.code}`);
  await expect(priya.getByText("Times I'd actually be up for")).toBeVisible();
  await expect(priya.getByText(changed)).toHaveCount(0);
  await priya.goto(`/circles/${circleId}`);
  await expect(priya.getByText('Finding a time')).toBeVisible();
  await expect(priya.getByText(cleared)).toHaveCount(0);
  await expect(priya.getByRole('button', { name: "See how it's looking" })).toBeVisible();
});
