import { expect, test } from './fixtures';
import { joinsAndAnswers, signedInAs } from './journeys';
import { letterTo, linkIn, runDispatcher } from './mail';
import {
  addressOf,
  answersKeen,
  askedInSql,
  asksFromTheForm,
  expectNothingConnects,
  keenInSql,
  mayaAsks,
  open,
  savedPlaces,
  threeOfUs,
  watched,
} from './quiet-people';
import { sql, sundayCrew } from './stack';

/**
 * The quiet ask end to end (S2-03, spec §5.4): three members, Maya asks
 * quietly, Tom and Jess are keen, it opens, and **Tom** — not the person who
 * asked — picks the time. An ask that runs out shows its neutral screen to
 * Maya alone. And the rest of the ways an ask goes (S2-08): the initiator's
 * letter, the owner's fallback, a withdrawal, the refusals, and a keen guest.
 * The seed's own quiet ask, scenario C, is `seed.spec.ts`'s.
 *
 * The acceptance criterion this file exists for is the negative one: **no
 * response any of their browsers receive about the ask, and no analytics row,
 * connects Maya to it.** Every response from the quiet functions and every
 * read of `plans` is kept and searched for her id and for any key that would
 * name an initiator or an answer (`quiet-people.ts`).
 */

test('three members: Maya asks quietly, it opens in front of her, and Tom picks the time', async ({
  browser,
}) => {
  // Half a minute of the view's poll is skipped with the page's clock, but a
  // slow WebKit still walks three browsers through five screens.
  test.setTimeout(120_000);
  const { circleId, maya, tom, jess } = await threeOfUs(browser);
  const planId = await mayaAsks(maya, circleId);

  // The card on circle home says nothing about whose it is: Maya's reads the
  // same as Tom's.
  await maya.page.goto(`/circles/${circleId}`);
  const mayasCard = await maya.page.getByText('Asked quietly').locator('xpath=../..').innerText();

  await answersKeen(tom, circleId);
  const tomsCard = await tom.page
    .goto(`/circles/${circleId}`)
    .then(() => tom.page.getByText('Asked quietly').locator('xpath=../..').innerText());
  expect(tomsCard).toBe(mayasCard);

  // Maya waits on her own ask. This device has watched her ask, so when it
  // opens she is offered the initiator's choice — through the view's
  // half-minute poll, never a reload, which would forget that she watched.
  await maya.page.clock.install();
  await maya.page.goto(`/circles/${circleId}/quiet/${planId}`);
  await expect(maya.page.getByRole('button', { name: 'Withdraw the ask' })).toBeVisible();

  await answersKeen(jess, circleId, { opensIt: true });
  expect(sql(`select state from public.plans where id = '${planId}'`)[0]?.[0]).toBe('collecting');

  await maya.page.clock.fastForward('00:31');
  await expect(maya.page.getByRole('button', { name: "I'll organise" })).toBeVisible({
    timeout: 40_000,
  });
  await expect(
    maya.page.getByText(/^3 of you want to catch up in the next 7 days\. Someone needs/),
  ).toBeVisible();
  // She would rather somebody else did: the role is left to the keen.
  await maya.page.getByRole('button', { name: 'Ask for a volunteer' }).click();
  await expect(maya.page).toHaveURL(new RegExp(`/circles/${circleId}$`));

  // Tom, who did not ask, takes it on from the quiet screen.
  await tom.page.goto(`/circles/${circleId}/quiet/${planId}`);
  await expect(
    tom.page.getByText('3 people are keen to catch up in the next 7 days.'),
  ).toBeVisible();
  await expect(tom.page.getByText("3 said they're keen. We don't show who.")).toBeVisible();
  await expect(tom.page.getByText(/so far/)).toHaveCount(0);
  await expect(tom.page.getByRole('button', { name: "I'll organise" })).toHaveCount(0);
  await tom.page.getByRole('button', { name: "I'll pick the time" }).click();
  await expect(tom.page).toHaveURL(new RegExp(`/circles/${circleId}/plan/${planId}/shared$`));
  expect(sql(`select organiser_user_id from public.plans where id = '${planId}'`)[0]?.[0]).toBe(
    tom.userId,
  );

  // Maya, who asked, is told who is picking — and nothing about having asked.
  await maya.page.goto(`/circles/${circleId}/quiet/${planId}`);
  await expect(maya.page.getByText(/^Tom volunteered to pick the time\./)).toBeVisible();
  await expect(maya.page.getByRole('button', { name: 'Choose my times' })).toBeVisible();

  expectNothingConnects(maya, maya, tom, jess);

  // Starting the ask and answering it are recorded against nobody, and about
  // nothing: no user, no browser, no plan, no circle, no properties.
  const ids = [...maya.quietEvents, ...tom.quietEvents, ...jess.quietEvents];
  expect(ids).toHaveLength(3);
  const list = ids.map((id) => `'${id}'`).join(', ');
  await expect
    .poll(() => sql(`select count(*) from analytics.events where event_id in (${list})`)[0]?.[0])
    .toBe('3');
  expect(
    sql(`select distinct coalesce(user_id::text, '-'), coalesce(anonymous_id, '-'),
           coalesce(plan_id::text, '-'), coalesce(circle_id::text, '-'), properties::text
         from analytics.events where event_id in (${list})`),
  ).toEqual([['-', '-', '-', '-', '{}']]);
  // Taking the role is public, and says nothing about how.
  expect(
    sql(`select user_id, properties::text from analytics.events
         where plan_id = '${planId}' and event_name = 'organiser_accepted'`),
  ).toEqual([[tom.userId, '{}']]);
});

test('an ask that runs out is "closed quietly" to Maya and nothing to anybody else', async ({
  browser,
}) => {
  const { circleId, maya, tom } = await threeOfUs(browser);
  const planId = await mayaAsks(maya, circleId);

  // Past its stop time: the view says closed from then, before any sweep.
  sql(`
    begin;
    select set_config('circles.in_transition', 'on', true);
    update public.plans set quiet_expires_at = now() - interval '1 minute' where id = '${planId}';
    commit;
  `);

  await maya.page.reload();
  await expect(maya.page.getByText('Not enough people were free this time.')).toBeVisible();
  await expect(maya.page.getByRole('button', { name: 'Try again another time' })).toBeVisible();

  await tom.page.goto(`/circles/${circleId}/quiet/${planId}`);
  await expect(tom.page.getByText("This isn't open any more.")).toBeVisible();
  await expect(tom.page.getByText('Not enough people were free this time.')).toHaveCount(0);
  await tom.page.goto(`/circles/${circleId}`);
  await expect(tom.page.getByText('Asked quietly')).toHaveCount(0);

  expectNothingConnects(maya, maya, tom);
});

test('the initiator’s own letter opens Volunteer, not ThresholdRole: a letter cannot say who reads it', async ({
  page,
  baseURL,
}) => {
  const {
    circleId,
    people: [maya, tom, jess],
  } = await savedPlaces('Maya', 'Tom', 'Jess');
  const ask = askedInSql(circleId, maya!.userId);
  keenInSql(ask.id, tom!.userId);
  keenInSql(ask.id, jess!.userId);
  expect(sql(`select state from public.plans where id = '${ask.id}'`)[0]?.[0]).toBe('collecting');

  // The drain writes the initiator's letter; quiet hours may hold it until
  // morning where she is, so it is released before it is read (SUS-91).
  const written = () =>
    sql(`select count(*) from jobs.notification_jobs
         where plan_id = '${ask.id}' and kind = 'threshold_initiator'`)[0]![0];
  for (let attempt = 0; attempt < 20 && written() === '0'; attempt += 1) await runDispatcher();
  expect(written()).toBe('1');
  sql(`update jobs.notification_jobs set scheduled_for = now()
       where plan_id = '${ask.id}' and status = 'scheduled'`);
  const letter = await letterTo(addressOf(maya!.userId), /^Sunday Crew: enough people are keen$/);
  expect(letter.text).not.toMatch(/Tom|Jess|\b[23] (of|people)\b/);

  await signedInAs(page, maya!.stored);
  const reading = watched(page, maya!);
  await page.goto(linkIn(letter, new RegExp(`^/p/${ask.code}$`), baseURL!));
  await expect(page.getByText('3 people are keen to catch up in the next 7 days.')).toBeVisible();
  await expect(page.getByRole('button', { name: "I'll organise" })).toHaveCount(0);
  expectNothingConnects(maya!, reading);

  // "I'll pick the time" works for her too: it is the same capability.
  await page.getByRole('button', { name: "I'll pick the time" }).click();
  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/plan/${ask.id}/shared$`));
  expect(sql(`select organiser_user_id from public.plans where id = '${ask.id}'`)[0]?.[0]).toBe(
    maya!.userId,
  );
});

test('an ask that opens is counted: quiet_threshold_reached, against nobody', async () => {
  test.skip(test.info().project.name !== 'android-chrome', 'no browser involved');
  test.fail(true, 'SUS-97: nothing emits quiet_threshold_reached yet');
  const {
    circleId,
    people: [maya, tom, jess],
  } = await savedPlaces('Maya', 'Tom', 'Jess');
  const ask = askedInSql(circleId, maya!.userId);
  keenInSql(ask.id, tom!.userId);
  keenInSql(ask.id, jess!.userId);
  const counted = () =>
    sql(`select coalesce(user_id::text, '-'), properties ->> 'threshold' from analytics.events
         where event_name = 'quiet_threshold_reached' and plan_id = '${ask.id}'`);
  for (let attempt = 0; attempt < 10 && counted().length === 0; attempt += 1) {
    await runDispatcher();
  }
  expect(counted()).toEqual([['-', '3']]);
});

test('replies close with nobody organising: the owner, who never answered, may take it on then and not before', async ({
  browser,
}) => {
  const {
    circleId,
    people: [maya, tom, jess, priya],
  } = await savedPlaces('Maya', 'Tom', 'Jess', 'Priya');
  // Tom asks; Jess and Priya are keen, which is three of four. Maya owns the
  // circle and says nothing.
  const ask = askedInSql(circleId, tom!.userId);
  keenInSql(ask.id, jess!.userId);
  keenInSql(ask.id, priya!.userId);
  const owner = await open(browser, maya!);

  await owner.page.goto(`/p/${ask.code}`);
  await expect(owner.page.getByText(/^Someone needs to pick the time\./)).toBeVisible();
  await expect(owner.page.getByRole('button', { name: "I'll pick the time" })).toHaveCount(0);

  // Replies close with the role still empty: the owner's fallback.
  sql(`update public.plans set response_deadline = now() - interval '1 minute'
       where id = '${ask.id}'`);
  await owner.page.reload();
  await owner.page.getByRole('button', { name: "I'll pick the time" }).click();
  await expect(owner.page).toHaveURL(new RegExp(`/circles/${circleId}/plan/${ask.id}/shared$`));
  expect(sql(`select organiser_user_id from public.plans where id = '${ask.id}'`)[0]?.[0]).toBe(
    maya!.userId,
  );
  expectNothingConnects(tom!, owner);
});

test('Maya’s refusals are about her, in words; and she withdraws, and nobody is told', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { circleId, maya, tom } = await threeOfUs(browser);
  const planId = await mayaAsks(maya, circleId);
  const circle = sql(`select name from public.circles where id = '${circleId}'`)[0]![0]!;

  // A second ask while her first is open.
  await maya.page.goto(`/circles/${circleId}/quiet/new`);
  await asksFromTheForm(maya.page);
  await expect(
    maya.page.getByText(`You already have a quiet ask open in ${circle}. It has to close first.`),
  ).toBeVisible();
  await expect(maya.page).toHaveURL(new RegExp(`/circles/${circleId}/quiet/new$`));

  // Withdrawn from SparkWaiting: it closes, and to Tom it is the page every
  // closed ask is.
  await maya.page.goto(`/circles/${circleId}/quiet/${planId}`);
  await maya.page.getByRole('button', { name: 'Withdraw the ask' }).click();
  await expect(
    maya.page.getByText('It closes now, and nobody is told it was asked.'),
  ).toBeVisible();
  await maya.page.getByRole('button', { name: 'Withdraw', exact: true }).click();
  await expect(maya.page).toHaveURL(new RegExp(`/circles/${circleId}$`));
  expect(sql(`select state from public.plans where id = '${planId}'`)[0]?.[0]).toBe('cancelled');
  await tom.page.goto(`/circles/${circleId}/quiet/${planId}`);
  await expect(tom.page.getByText("This isn't open any more.")).toBeVisible();
  await tom.page.goto(`/circles/${circleId}`);
  await expect(tom.page.getByText('Asked quietly')).toHaveCount(0);

  // Muted while the form was open: the refusal, then, read again, the statement.
  await maya.page.goto(`/circles/${circleId}/quiet/new`);
  await expect(maya.page.getByRole('button', { name: 'Ask quietly' })).toBeVisible();
  const muted = (on: boolean) =>
    sql(`update public.circle_members set muted_quiet_asks = ${on}
         where circle_id = '${circleId}' and user_id = '${maya.userId}'`);
  muted(true);
  await asksFromTheForm(maya.page);
  await expect(maya.page.getByText(`You've muted quiet asks in ${circle}.`)).toBeVisible();
  await maya.page.reload();
  await expect(maya.page.getByText(`You've muted quiet asks in ${circle}.`)).toBeVisible();
  await expect(
    maya.page.getByText('Turn them back on in circle settings to start one.'),
  ).toBeVisible();
  muted(false);

  // Three asks in the circle this week, the withdrawn one among them.
  for (const asker of [tom.userId, maya.userId]) {
    const extra = askedInSql(circleId, asker);
    sql(`begin;
         select set_config('circles.in_transition', 'on', true);
         update public.plans set state = 'cancelled' where id = '${extra.id}';
         commit;`);
  }
  await maya.page.goto(`/circles/${circleId}/quiet/new`);
  await asksFromTheForm(maya.page);
  await expect(
    maya.page.getByText(
      `${circle} has had 3 quiet asks this week. Try again in a few days, or plan openly.`,
    ),
  ).toBeVisible();

  expectNothingConnects(maya, tom);
});

test('a keen guest is not offered the role: the ask opens to them as a member’s', async ({
  page,
}) => {
  const crew = sundayCrew();
  await joinsAndAnswers(page, crew, 'Priya');
  sql(`select planning.transition_plan('${crew.planId}', 'cancel', '${crew.ownerId}', '{}')`);
  // Maya asks; of two members, two keen opens it.
  const ask = askedInSql(crew.circleId, crew.ownerId);
  const priya = watched(page, { userId: '', name: 'Priya' });

  await answersKeen(priya, crew.circleId, { opensIt: true });
  await expect(page.getByRole('button', { name: 'Choose my times' })).toBeVisible();
  await expect(page.getByRole('button', { name: "I'll pick the time" })).toHaveCount(0);
  await expect(page.getByText('Save your place first')).toHaveCount(0);
  expect(sql(`select state from public.plans where id = '${ask.id}'`)[0]?.[0]).toBe('collecting');
  expectNothingConnects({ userId: crew.ownerId }, priya);
});
