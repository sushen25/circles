import { readFile } from 'node:fs/promises';

import { expect, test } from './fixtures';
import { sendEvenings, signedInAs } from './journeys';
import {
  circleOwnedBy,
  guestInvited,
  planFor,
  reentryTokenFor,
  signedInAccount,
  sql,
  type Scenario,
} from './stack';

/**
 * The organiser's whole loop, once, in order (spec §6.1, §5.6–§5.10; S1-27,
 * S1-28, S1-29): the scenario's five answers → the options they make → a
 * time locked in with a note and the chasing answer → the confirmed screen for
 * the organiser and for a guest → the calendar file → the morning after →
 * "it happened" → circle home says when they last caught up.
 *
 * Each step has its own spec with the edges (`candidates`, `confirmation`,
 * `morning-after`); this one is the proof that they join up — that what one
 * screen writes is what the next one reads.
 *
 * "Next morning" needs no clock: every "has it finished?" in the product is the
 * database's `now()`, so the confirmation's times are moved back in SQL
 * instead (S1-29's `happenedTheOtherNight`).
 */

/**
 * Priya, Tom, Jess and Sam, answered: each is free 6:30–8:30 pm on the plan's
 * second evening, the scenario's Thursday. Alex is asked and says nothing.
 * Written through `replace_response` as each of them, so every answer is the
 * product's own; the engine runs when Maya sends hers.
 */
function theCrewAnswers(crew: Scenario): void {
  for (const name of ['Priya', 'Tom', 'Jess', 'Sam']) {
    const userId = guestInvited(crew, name);
    sql(`
      begin;
      select set_config('role', 'authenticated', true);
      select set_config('request.jwt.claims',
        '{"sub": "${userId}", "role": "authenticated", "is_anonymous": true}', true);
      select public.replace_response('${crew.planId}', 1, 'windows', jsonb_build_array(jsonb_build_object(
        'start', ((current_date + 8)::timestamp + interval '18 hours 30 minutes') at time zone 'Australia/Melbourne',
        'end', ((current_date + 8)::timestamp + interval '20 hours 30 minutes') at time zone 'Australia/Melbourne'
      )));
      commit;
    `);
  }
  guestInvited(crew, 'Alex');
}

test('five answers to a lock-in, a calendar file, the morning after, and circle home remembers', async ({
  page,
  browser,
}) => {
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
  theCrewAnswers(crew);
  await signedInAs(page, maya.stored);

  // Maya's own answer: the same evening, all of it. Five of six have answered.
  await page.goto(`/j/${plan.code}`);
  await sendEvenings(page, plan.code, 1);

  // The options match the scenario: 6:30–8:30 pm, five of six, Alex named.
  await page.goto(`/circles/${circleId}/plan/${plan.id}/candidates`);
  await expect(page.getByText('Best attendance')).toBeVisible();
  await expect(page.getByText('5 of 6').first()).toBeVisible();
  await expect(page.getByText('5 of 6 replied')).toBeVisible();
  await expect(page.getByText("Alex hasn't answered").first()).toBeVisible();
  await expect(page.getByText(/6:30\s*–\s*8:30\s*pm/).first()).toBeVisible();

  // Lock it in, with a place, a note and the chasing answer.
  await page
    .getByRole('button', { name: /^Review / })
    .first()
    .click();
  await expect(page.getByText('Lock it in?')).toBeVisible();
  await page.getByLabel('Where it is').fill('Hope St Radio');
  await page.getByLabel('A note for everyone').fill('Upstairs, by the window.');
  await page.getByRole('checkbox', { name: 'No', exact: true }).click();
  await page.getByRole('button', { name: 'Lock it in', exact: true }).click();

  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/plan/${plan.id}/confirmed$`));
  await expect(page.getByText(/^Locked in: Sunday Crew, .* at Hope St Radio\./)).toBeVisible();
  const [stored] = sql(`
    select place_name, note, chased_answer,
      to_char(starts_at at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"'),
      to_char(starts_at at time zone 'Australia/Melbourne', 'HH24:MI')
    from public.meetup_confirmations where plan_id = '${plan.id}' and status = 'active'
  `);
  expect(stored).toEqual([
    'Hope St Radio',
    'Upstairs, by the window.',
    'none',
    expect.stringMatching(/^\d{8}T\d{6}Z$/),
    '18:30',
  ]);

  // The calendar file downloads, and says what was locked in.
  await page.getByRole('button', { name: 'Add to my calendar' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /^Apple or device calendar/ }).click();
  const ics = await readFile((await (await download).path())!, 'utf8');
  const lines = ics.split(/\r\n/);
  expect(lines[0]).toBe('BEGIN:VCALENDAR');
  expect(lines).toContain(`DTSTART:${stored![3]}`);
  expect(lines.find((line) => line.startsWith('SUMMARY:'))).toMatch(/^SUMMARY:Sunday Crew/);
  expect(lines).toContain('LOCATION:Hope St Radio');
  expect(lines.filter((line) => line === 'BEGIN:VEVENT')).toHaveLength(1);

  // A guest's confirmed screen: Tom, from the way back in, on his own phone.
  const tom = sql(`select user_id from public.circle_members
    where circle_id = '${circleId}' and display_name_snapshot = 'Tom'`)[0]![0]!;
  const phone = await browser.newContext();
  const tomsPage = await phone.newPage();
  await tomsPage.goto(`/a#${reentryTokenFor(crew, tom)}`);
  await expect(tomsPage).toHaveURL(new RegExp(`/circles/${circleId}$`));
  await tomsPage.goto(`/p/${plan.code}`);
  await expect(tomsPage).toHaveURL(new RegExp(`/p/${plan.code}/confirmed$`));
  await expect(tomsPage.getByText("You're going")).toBeVisible();
  await expect(tomsPage.getByText('Hope St Radio').first()).toBeVisible();
  await expect(tomsPage.getByText('Upstairs, by the window.', { exact: false })).toBeVisible();
  await phone.close();

  // The morning after (two days on, so nine the next morning has come
  // whatever hour this runs).
  sql(`update public.meetup_confirmations
    set starts_at = now() - interval '50 hours', ends_at = now() - interval '48 hours'
    where plan_id = '${plan.id}' and status = 'active'`);

  await page.goto(`/circles/${circleId}`);
  await expect(page.getByText('Not yet')).toBeVisible();
  await expect(page.getByText(/^Did .+'s catch-up happen\?$/)).toBeVisible();
  await page.getByRole('button', { name: 'Answer' }).click();
  await page.getByRole('radio', { name: 'It happened' }).click();
  await page.getByRole('checkbox', { name: 'No' }).click();
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}$`));
  await expect(page.getByText('Not yet')).toHaveCount(0);
  await expect(page.getByText(/^Did .+'s catch-up happen\?$/)).toHaveCount(0);
  expect(
    sql(`select last_met_at is not null from public.circles where id = '${circleId}'`)[0]![0],
  ).toBe('t');
});
