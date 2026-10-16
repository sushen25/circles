// @e2e: core
import { expect, test, type Page } from './fixtures';

import { days, joinsAndAnswers, sendEvenings, signedInAs } from './journeys';
import { runDispatcher } from './mail';
import { circleOwnedBy, guestInvited, planFor, signedInAccount, sql, type Scenario } from './stack';

/**
 * A plan that cannot reach its quorum, and every way out the screen offers
 * (spec §5.6, S1-16, S2-05).
 *
 * Until now only the unit tests and the fixture smoke reached `/no-quorum`.
 * This one gets there with real answers through the real engine, then takes
 * each exit in turn, on a plan of its own, and asserts where it lands and what
 * it leaves in the database:
 *
 * - lower the number: the options the number unlocks, and the number kept;
 * - a wider window: who is asked again, before saving; then the new question;
 * - set the time yourself: the time picker, in lock-in mode;
 * - close the attempt: asked first, then off, and the circle's home;
 * - one more day: once replies have closed, in the wider window's place;
 * - change who has to be there: the plan's editor, when a required member is
 *   the rule that blocked it (and lowering the number is then not offered);
 * - change my times: the organiser's own editor, and back here afterwards.
 *
 * The near-miss cards are on the same screen, so they are asserted where the
 * plan is first reached: the closest time, with who is in and who is not.
 */

type Stuck = {
  maya: { userId: string; stored: string };
  crew: Scenario;
  tom: string;
  nina: string;
};

/** The evening of `day` days from today, as a window in Melbourne: 6:30 to 8:30 pm. */
const evening = (day: number) => `jsonb_build_object(
  'start', ((current_date + ${day})::timestamp + interval '18 hours 30 minutes') at time zone 'Australia/Melbourne',
  'end', ((current_date + ${day})::timestamp + interval '20 hours 30 minutes') at time zone 'Australia/Melbourne')`;

/** `replace_response` as `userId`: the product's own write, as `replace_response` is the only one. */
function answers(planId: string, userId: string, day: number, anonymous: boolean): void {
  sql(`
    begin;
    select set_config('role', 'authenticated', true);
    select set_config('request.jwt.claims',
      '{"sub": "${userId}", "role": "authenticated", "is_anonymous": ${anonymous}}', true);
    select public.replace_response('${planId}', 1, 'windows', jsonb_build_array(${evening(day)}));
    commit;
  `);
}

/** Whether the engine has stored near-misses for the plan as it stands. */
const nearMisses = (planId: string) =>
  Number(
    sql(`select count(*) from public.candidates c
         join public.candidate_sets s on s.id = c.candidate_set_id
         join public.plans p on p.id = s.plan_id
           and p.revision = s.revision and p.input_version = s.input_version
         where p.id = '${planId}' and c.is_near_miss`)[0]![0],
  );

async function engineRuns(planId: string): Promise<void> {
  for (let attempt = 0; attempt < 20 && nearMisses(planId) === 0; attempt += 1) {
    await runDispatcher();
  }
  expect(nearMisses(planId)).toBeGreaterThan(0);
}

/**
 * Maya's circle, with Tom and Nina in it. Maya and Tom can make the same
 * evening; Nina can make a different one. At a quorum of three, nothing works,
 * and the closest time has two of the three. `requiredNina` makes Nina the
 * person without whom no time counts, which changes the rule that blocked it.
 *
 * The answers are written as `replace_response`, as `closedWithAnOption` does,
 * and the engine is the dispatcher's, run until it has near-misses to show.
 */
async function stuck(
  page: Page,
  { requiredNina = false }: { requiredNina?: boolean } = {},
): Promise<Stuck> {
  const maya = await signedInAccount('Maya');
  const circleId = circleOwnedBy(maya.userId, 'Sunday Crew');
  const plan = planFor(circleId, maya.userId, requiredNina ? 2 : 3);
  const crew: Scenario = {
    circleId,
    planId: plan.id,
    planCode: plan.code,
    ownerId: maya.userId,
    secret: '',
  };
  // A number the plan was given, not one the organiser chose: lowering it is
  // then the moment it becomes the plan's own.
  sql(`update public.plans set quorum_source = 'defaulted' where id = '${plan.id}'`);
  const tom = guestInvited(crew, 'Tom');
  const nina = guestInvited(crew, 'Nina');
  if (requiredNina) {
    sql(`insert into public.plan_required_members (plan_id, revision, user_id)
         values ('${plan.id}', 1, '${nina}')`);
  }
  answers(plan.id, tom, 8, true);
  answers(plan.id, nina, 11, true);
  // Maya answers last, through the editor: `submit-availability` runs the
  // engine in the request that caused it, so the near-misses do not wait on
  // the dispatcher's sweep, which is shared with every other test.
  await signedInAs(page, maya.stored);
  await page.goto(`/j/${plan.code}`);
  await sendEvenings(page, plan.code, 1);
  await engineRuns(plan.id);
  return { maya, crew, tom, nina };
}

const planOf = (planId: string) =>
  sql(`select state, quorum, revision, window_end - window_start,
         quorum_source from public.plans where id = '${planId}'`)[0]!;

/** Opens the plan the way an organiser does, on its candidates route: the data picks the screen. */
async function opens(page: Page, { crew }: Stuck): Promise<void> {
  await page.goto(`/circles/${crew.circleId}/plan/${crew.planId}/candidates`);
  await expect(page.getByText("There wasn't enough overlap this time.")).toBeVisible();
}

test('the organiser reaches it with real answers, and sees the closest time and what unlocks it', async ({
  page,
  browser,
}) => {
  // The answers here are the journey's own, in three browsers: Tom and Nina
  // are strangers on the plan link, and Maya answers from hers.
  const maya = await signedInAccount('Maya');
  const circleId = circleOwnedBy(maya.userId, 'Sunday Crew');
  const plan = planFor(circleId, maya.userId, 3);
  const crew: Scenario = {
    circleId,
    planId: plan.id,
    planCode: plan.code,
    ownerId: maya.userId,
    secret: '',
  };
  for (const [name, day] of [
    ['Tom', 1],
    ['Nina', 4],
  ] as const) {
    const guest = await browser.newContext();
    await joinsAndAnswers(await guest.newPage(), crew, name, day);
    await guest.close();
  }
  await signedInAs(page, maya.stored);
  await page.goto(`/j/${plan.code}`);
  await sendEvenings(page, plan.code, 1);
  await engineRuns(plan.id);

  await page.goto(`/circles/${circleId}/plan/${plan.id}/candidates`);
  // The candidates route and the no-quorum route are one flow: the data picks
  // the screen, so the organiser who opens either lands on the right one.
  await expect(page.getByText("There wasn't enough overlap this time.")).toBeVisible();
  await expect(
    page.getByText('Nothing in the window works for at least 3 of you.', { exact: false }),
  ).toBeVisible();

  // The closest, with the people it works for and the one it does not: the
  // near-miss says who is out, and nobody is named as having let anyone down.
  await expect(page.getByText('Closest', { exact: true })).toBeVisible();
  await expect(page.getByText('2 of 3').first()).toBeVisible();
  await expect(page.getByText("Doesn't work for Nina").first()).toBeVisible();

  // And the four exits, each with its row.
  await expect(page.getByRole('button', { name: /^Lower to 2 people\./ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Try a wider window\./ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Set the time yourself\./ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Close this attempt\./ })).toBeVisible();
  expect(planOf(plan.id).slice(0, 2)).toEqual(['collecting', '3']);
});

test('lowering the number unlocks the closest time, and the plan keeps the number', async ({
  page,
}) => {
  const plan = await stuck(page);
  await opens(page, plan);
  const lower = page.getByRole('button', { name: /^Lower to 2 people\./ });
  await expect(lower).toContainText('keeps 2 as its number');
  await lower.click();

  // The same flow, now ready: the options the number unlocked.
  await expect(page.getByText(/looks good for two of you\./)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Review / })).toBeVisible();
  const [state, quorum, revision, , source] = planOf(plan.crew.planId);
  // Permanent, and nobody is asked again: the revision is the same one.
  expect([state, quorum, revision, source]).toEqual(['ready', '2', '1', 'chosen']);
});

test('a wider window shows who is asked again, can be kept as it is, and then asks the new question', async ({
  page,
}) => {
  const plan = await stuck(page);
  await opens(page, plan);
  const before = planOf(plan.crew.planId);

  await page.getByRole('button', { name: /^Try a wider window\./ }).click();
  await expect(page.getByText('Ask about more days?')).toBeVisible();
  await expect(page.getByText(/asked again: you, (Nina and Tom|Tom and Nina)\./)).toBeVisible();

  // Keep it as it is: nothing is saved.
  await page.getByRole('button', { name: 'Keep it as it is' }).first().click();
  await expect(page.getByText('Ask about more days?')).toBeHidden();
  expect(planOf(plan.crew.planId)).toEqual(before);

  await page.getByRole('button', { name: /^Try a wider window\./ }).click();
  await page.getByRole('button', { name: 'Ask again' }).click();

  // The question moved: a new revision over thirty days, and the answers to
  // the old one went with it, so there is nothing to be close to.
  await expect(page.getByText('Waiting on the first reply.')).toBeVisible();
  await expect.poll(() => planOf(plan.crew.planId)[2]).toBe('2');
  expect(planOf(plan.crew.planId)[3]).toBe('29');
  expect(
    sql(`select count(*) from public.plan_responses
         where plan_id = '${plan.crew.planId}' and revision = 2`),
  ).toEqual([['0']]);
});

test('"Set the time yourself" opens the picker for this plan, in lock-in mode', async ({
  page,
}) => {
  const plan = await stuck(page);
  await opens(page, plan);
  await page.getByRole('button', { name: /^Set the time yourself\./ }).click();

  await expect(page).toHaveURL(
    new RegExp(`/circles/${plan.crew.circleId}/plan/${plan.crew.planId}/set-time\\?.*mode=lock`),
  );
  await expect(page.getByText('Pick the time yourself')).toBeVisible();
  expect(planOf(plan.crew.planId)[0]).toBe('collecting');
});

test('closing the attempt asks first, can be kept open, and then takes the circle home', async ({
  page,
}) => {
  const plan = await stuck(page);
  await opens(page, plan);

  await page.getByRole('button', { name: /^Close this attempt\./ }).click();
  await expect(page.getByText('Close this attempt?')).toBeVisible();
  await expect(
    page.getByText('Everyone is told the plan is off. No reason is given and nobody is named.'),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Keep it open' }).first().click();
  await expect(page.getByText('Close this attempt?')).toBeHidden();
  expect(planOf(plan.crew.planId)[0]).toBe('collecting');

  await page.getByRole('button', { name: /^Close this attempt\./ }).click();
  await page.getByRole('button', { name: 'Close it' }).click();

  await expect(page).toHaveURL(new RegExp(`/circles/${plan.crew.circleId}$`));
  expect(planOf(plan.crew.planId)[0]).toBe('cancelled');
});

test('once replies have closed, one more day stands in for the wider window', async ({ page }) => {
  const plan = await stuck(page);
  sql(`update public.plans set response_deadline = now() - interval '1 minute'
       where id = '${plan.crew.planId}'`);
  await opens(page, plan);

  // A wider window starts a new revision, which a closed deadline refuses.
  await expect(page.getByRole('button', { name: /^Try a wider window\./ })).toHaveCount(0);
  await page
    .getByRole('button', { name: /^Give it one more day\. Reopens replies until / })
    .click();

  // Replies are open again, and the wider window is back.
  await expect(page.getByRole('button', { name: /^Try a wider window\./ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Give it one more day\./ })).toHaveCount(0);
  expect(
    sql(`select deadline_extended_on_revision, response_deadline > now() + interval '23 hours'
         from public.plans where id = '${plan.crew.planId}'`),
  ).toEqual([['1', 't']]);
});

test('when a required member is the rule, the way out is the editor, and the number is not offered', async ({
  page,
}) => {
  const plan = await stuck(page, { requiredNina: true });
  await opens(page, plan);

  await expect(page.getByText(/Nina has to be there and can't make any of these\./)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Lower to / })).toHaveCount(0);
  await page.getByRole('button', { name: /^Change who has to be there\./ }).click();

  await expect(page).toHaveURL(
    new RegExp(`/circles/${plan.crew.circleId}/plan/${plan.crew.planId}/edit$`),
  );
  await expect(page.getByText('Edit plan').first()).toBeVisible();
});

test('the organiser changes their own times from it, and comes back to it', async ({ page }) => {
  const plan = await stuck(page);
  await opens(page, plan);
  await page.getByRole('button', { name: 'Change my times' }).click();

  await expect(page).toHaveURL(new RegExp(`/j/${plan.crew.planCode}\\?.*returnTo=plan`));
  await expect(page.getByText('Which evenings could work?')).toBeVisible();

  // Adding a day sends her back to the plan she came from, not to the sent screen.
  await page.waitForLoadState('networkidle');
  await days(page).nth(2).click();
  await page.getByRole('button', { name: 'Send my times' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/circles/${plan.crew.circleId}/plan/${plan.crew.planId}/candidates$`),
  );
  await expect(page.getByText("There wasn't enough overlap this time.")).toBeVisible();
  // Her answer now holds both evenings.
  expect(
    sql(`select count(*) from public.willing_windows w
         join public.plan_responses r on r.id = w.response_id
         where r.plan_id = '${plan.crew.planId}' and r.user_id = '${plan.maya.userId}'`),
  ).toEqual([['2']]);
});
