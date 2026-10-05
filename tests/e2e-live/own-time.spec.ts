import { expect, test, type Page } from './fixtures';
import { addressFor, joinsAndAnswers, signedInAs, subscribesFromSent } from './journeys';
import { lettersTo, runDispatcher } from './mail';
import {
  attendanceStatusOf,
  circleOwnedBy,
  firstDayOf,
  guestInvited,
  guestWhoAnswered,
  planFor,
  revisionOf,
  signedInAccount,
  sql,
} from './stack';

/**
 * The organiser sets the final plan, end to end (SUS-138, ADR 0051): a day and
 * time no option offered, below the plan's number, with who it works for said
 * before it is locked in; a guest who finds themselves "to confirm" and says
 * they can come; the organiser moving it, which tells people once and asks
 * nobody for their times again; and a change of place, which tells nobody.
 *
 * Quorum four, so one person who is easy is below it. Tom said "I'm easy" and
 * Alex has not answered; Ren, on his own device, answered one evening and asked
 * for updates by email.
 */

/** The day of the month an ISO date falls on, for the calendar's button. */
function dayOfMonth(isoDate: string, plusDays = 0): number {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + plusDays);
  return date.getUTCDate();
}

/** Picks a day on the picker, paging on to the next month when it is not on the one shown. */
async function pickDay(page: Page, isoDate: string, plusDays = 0): Promise<void> {
  const number = dayOfMonth(isoDate, plusDays);
  const grid = page.getByRole('group', { name: 'The day' });
  const day = () => grid.getByRole('button', { name: new RegExp(`\\b${number}\\b`) }).first();
  const usable = async () =>
    (await day()
      .isVisible()
      .catch(() => false)) && (await day().getAttribute('aria-disabled')) !== 'true';
  if (!(await usable())) await page.getByRole('button', { name: 'Later month' }).click();
  await day().click();
}

test('the organiser locks in a time of their own, moves it, and changes the place', async ({
  page,
  browser,
}) => {
  const maya = await signedInAccount('Maya');
  const circleId = circleOwnedBy(maya.userId, 'Sunday Crew');
  const plan = planFor(circleId, maya.userId);
  const crew = { circleId, planId: plan.id, planCode: plan.code, ownerId: maya.userId, secret: '' };
  sql(`update public.plans set quorum = 4 where id = '${plan.id}'`);
  guestWhoAnswered(crew, 'Tom');
  guestInvited(crew, 'Alex');

  // Ren answers one evening, on a device of his own, and asks for updates.
  const renPage = await (await browser.newContext()).newPage();
  const renId = await joinsAndAnswers(renPage, crew, 'Ren');
  const address = addressFor('ren');
  await subscribesFromSent(renPage, address);

  const first = firstDayOf(plan.id);
  await signedInAs(page, maya.stored);
  await page.goto(`/circles/${circleId}/plan/${plan.id}/candidates`);

  // Nothing reaches four, and the fourth row is the organiser's own time.
  await page.getByRole('button', { name: /^Set the time yourself\./ }).click();
  await expect(page.getByText('Pick the time yourself')).toBeVisible();
  await pickDay(page, first);

  // Who it works for, by name, and the caution: it is below the number.
  await expect(page.getByText(/^1 of 4 can make it$/)).toBeVisible();
  await expect(page.getByText(/^Tom can make it · /)).toBeVisible();
  await expect(
    page.getByText(/^That's 1 of you, and this plan asked for at least 4\./),
  ).toBeVisible();
  await page.getByRole('button', { name: /^Review / }).click();

  await expect(page.getByText('Lock it in?')).toBeVisible();
  await expect(
    page.getByText(/^This isn't one of the options, and the plan asked for at least 4\./),
  ).toBeVisible();
  await page.getByLabel('Where it is').fill('Hope St Radio');
  await page.getByRole('checkbox', { name: 'No' }).click();
  await page.getByRole('button', { name: 'Lock it in' }).click();

  // The plan's number is what it was, and nobody is "can't make it".
  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/plan/${plan.id}/confirmed$`));
  await expect(page.getByText('1 going · 3 to confirm')).toBeVisible();
  expect(sql(`select quorum from public.plans where id = '${plan.id}'`)[0]![0]).toBe('4');
  expect(
    sql(`select own_time, below_quorum from public.meetup_confirmations
      where plan_id = '${plan.id}' and status = 'active'`)[0],
  ).toEqual(['t', 't']);
  expect(attendanceStatusOf(plan.id, renId)).toBe('unknown');

  // Ren is to confirm, with the two buttons he already had.
  await renPage.goto(`/p/${plan.code}`);
  await expect(renPage).toHaveURL(new RegExp(`/p/${plan.code}/confirmed$`));
  await expect(renPage.getByText('Are you coming?')).toBeVisible();
  await renPage.getByRole('button', { name: 'I can make it' }).click();
  await expect(renPage.getByText("You're going")).toBeVisible();
  expect(attendanceStatusOf(plan.id, renId)).toBe('going');

  await runDispatcher();
  const locked = (await lettersTo(address)).filter((letter) => /^Locked in:/.test(letter.subject));
  expect(locked).toHaveLength(1);

  // Maya moves it to Ren's evening: who it works for is said before she saves.
  await page.getByRole('button', { name: 'Edit this plan' }).click();
  await expect(page.getByText(/^Change the time, the place or the note\./)).toBeVisible();
  await page.getByRole('button', { name: 'Change', exact: true }).click();
  await pickDay(page, first, 1);
  await expect(page.getByText(/^2 of 4 can make it$/)).toBeVisible();
  await page.getByRole('button', { name: /^Use / }).click();
  await expect(page.getByText(/^Everyone sees the new time straight away, with /)).toBeVisible();
  await expect(page.getByText(/Alex is asked whether they can come\.$/)).toBeVisible();
  await page.getByRole('button', { name: 'Save changes' }).click();

  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/plan/${plan.id}/confirmed$`));
  await expect(page.getByText(/^Moved from /)).toBeVisible();
  expect(revisionOf(plan.id)).toBe(1);
  expect(
    sql(`select status, superseded_reason from public.meetup_confirmations
      where plan_id = '${plan.id}' order by confirmed_at`),
  ).toEqual([
    ['superseded', 'move'],
    ['active', ''],
  ]);
  // Derived again from this revision's answers: Ren's times cover it.
  expect(attendanceStatusOf(plan.id, renId)).toBe('going');

  // The guest sees it moved, and is told once.
  await renPage.goto(`/p/${plan.code}/confirmed`);
  await expect(renPage.getByText(/^Moved from /)).toBeVisible();
  await runDispatcher();
  await runDispatcher();
  const moved = (await lettersTo(address)).filter((letter) =>
    /^Change of plan: Sunday Crew is now /.test(letter.subject),
  );
  expect(moved).toHaveLength(1);

  // A new place changes nobody's status, and sends nothing.
  await page.getByRole('button', { name: 'Edit this plan' }).click();
  await page.getByLabel('Where it is').fill('Naked for Satan');
  await expect(
    page.getByText(
      'A new place or note shows for everyone straight away. Nobody has to answer again.',
    ),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/plan/${plan.id}/confirmed$`));
  expect(
    sql(`select count(*), max(place_name) from public.meetup_confirmations
      where plan_id = '${plan.id}'`)[0],
  ).toEqual(['2', 'Naked for Satan']);
  expect(attendanceStatusOf(plan.id, renId)).toBe('going');
  await runDispatcher();
  expect(
    (await lettersTo(address)).filter((letter) =>
      /^New place:|^Change of plan:/.test(letter.subject),
    ),
  ).toHaveLength(1);

  // A second move in the same revision (SUS-152): a new confirmation, so a letter of
  // its own. The first move's letter had already gone, and the second was
  // dropped as a copy of it.
  await page.getByRole('button', { name: 'Edit this plan' }).click();
  await page.getByRole('button', { name: 'Change', exact: true }).click();
  await pickDay(page, first, 2);
  await page.getByRole('button', { name: /^Use / }).click();
  await expect(page.getByText(/^Everyone sees the new time straight away, with /)).toBeVisible();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/plan/${plan.id}/confirmed$`));
  expect(revisionOf(plan.id)).toBe(1);
  await runDispatcher();
  await runDispatcher();
  const changes = (await lettersTo(address)).filter((letter) =>
    /^Change of plan: Sunday Crew is now /.test(letter.subject),
  );
  expect(changes).toHaveLength(2);
  expect(new Set(changes.map((letter) => letter.subject)).size).toBe(2);
});
