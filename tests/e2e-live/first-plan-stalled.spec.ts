// @e2e: core
import { expect, test } from './fixtures';
import { circleOwnedBy, planFor, sessionStorageKey, signedInAccount, sql } from './stack';

/**
 * "Nothing in yet. What's happened?" (SUS-240, part 3): the one optional
 * question on a first plan's waiting screen, once the plan is 48 hours old and
 * nobody but its organiser has answered. Asked of the organiser and not of a
 * member; one tap records `first_plan_stalled` with the word and nothing else;
 * and it is never asked twice.
 *
 * The 48 hours are the plan's age in the database, so the plan is made, then
 * its creation moved back: the clock under test is the one the product reads.
 */
const QUESTION = "Nothing in yet. What's happened?";

test('the organiser is asked what happened after 48 hours, once, and Nina is not asked at all', async ({
  page,
  browser,
}) => {
  const maya = await signedInAccount('Maya');
  const nina = await signedInAccount('Nina');
  const circleId = circleOwnedBy(maya.userId, 'Sunday Crew');
  const plan = planFor(circleId, maya.userId);
  sql(`
    begin;
    insert into public.circle_members (circle_id, user_id, display_name_snapshot)
    values ('${circleId}', '${nina.userId}', 'Nina');
    insert into public.plan_participants (plan_id, revision, user_id)
    values ('${plan.id}', 1, '${nina.userId}') on conflict do nothing;
    update public.plans set created_at = now() - interval '49 hours' where id = '${plan.id}';
    commit;
  `);
  const here = `/circles/${circleId}/plan/${plan.id}/candidates`;
  const signIn = (stored: string) => ({
    content: `localStorage.setItem(${JSON.stringify(sessionStorageKey())}, ${JSON.stringify(stored)});`,
  });

  // Maya: the waiting screen, and the question on it.
  await page.addInitScript(signIn(maya.stored));
  await page.goto(here);
  await expect(page.getByText('Waiting on the first reply.')).toBeVisible();
  await expect(page.getByText(QUESTION)).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Skip' })).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);

  // Nina, in the same circle on the same plan, is not asked.
  const ninas = await browser.newContext();
  const ninaPage = await ninas.newPage();
  await ninaPage.addInitScript(signIn(nina.stored));
  await ninaPage.goto(here);
  await expect(ninaPage.getByRole('heading', { name: 'Waiting on a few more.' })).toBeVisible();
  await ninaPage.waitForTimeout(1_000);
  await expect(ninaPage.getByText(QUESTION)).toHaveCount(0);
  await ninas.close();

  // One tap: the event carries the word, and the question goes.
  await page.getByRole('checkbox', { name: "I posted it, no one's replied" }).click();
  await expect(page.getByText(QUESTION)).toHaveCount(0);
  await expect
    .poll(
      () =>
        sql(`select properties::text from analytics.events
             where event_name = 'first_plan_stalled' and user_id = '${maya.userId}'`)[0]?.[0],
    )
    .toBe('{"answer": "posted_no_replies"}');
  // And it never repeats: not on a reload, not on this plan again.
  await page.reload();
  await expect(page.getByText('Waiting on the first reply.')).toBeVisible();
  await page.waitForTimeout(1_000);
  await expect(page.getByText(QUESTION)).toHaveCount(0);
  expect(
    sql(`select count(*) from public.nudge_states
         where user_id = '${maya.userId}' and moment = 'first_plan_stalled'`)[0]?.[0],
  ).toBe('1');
});

test('Skip records nothing but that it was asked, and nothing is asked before 48 hours', async ({
  page,
}) => {
  const maya = await signedInAccount('Maya');
  const circleId = circleOwnedBy(maya.userId, 'Sunday Crew');
  const early = planFor(circleId, maya.userId);
  sql(`update public.plans set created_at = now() - interval '30 hours' where id = '${early.id}'`);
  await page.addInitScript({
    content: `localStorage.setItem(${JSON.stringify(sessionStorageKey())}, ${JSON.stringify(maya.stored)});`,
  });
  await page.goto(`/circles/${circleId}/plan/${early.id}/candidates`);
  await expect(page.getByText('Waiting on the first reply.')).toBeVisible();
  await page.waitForTimeout(1_000);
  await expect(page.getByText(QUESTION)).toHaveCount(0);

  sql(`update public.plans set created_at = now() - interval '49 hours' where id = '${early.id}'`);
  await page.reload();
  await expect(page.getByText(QUESTION)).toBeVisible();
  await page.getByRole('button', { name: 'Skip' }).click();
  await expect(page.getByText(QUESTION)).toHaveCount(0);
  await expect
    .poll(
      () =>
        sql(`select answer from public.nudge_states
             where user_id = '${maya.userId}' and moment = 'first_plan_stalled'`)[0]?.[0],
    )
    .toBe('dismissed');
  expect(
    sql(`select count(*) from analytics.events
         where event_name = 'first_plan_stalled' and user_id = '${maya.userId}'`)[0]?.[0],
  ).toBe('0');
});
