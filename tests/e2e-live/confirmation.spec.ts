import { expect, test, type Page } from './fixtures';

import {
  attendanceStatusOf,
  circleOwnedBy,
  confirmationOf,
  guestInvited,
  guestWhoAnswered,
  lockInFirstOption,
  memberNamed,
  planFor,
  sessionStorageKey,
  signedInAccount,
  sundayCrew,
} from './stack';

/**
 * Locking a time in, end to end (spec §5.7, S1-28): the review sends what the
 * screen showed, the confirmed screens read it back through RLS, a member
 * corrects their own answer, and the calendar file downloads.
 *
 * The unit tests render the screens against made-up rows and the integration
 * test calls the data layer with no screen. This is the one that walks both.
 */

/** Ticks a day, turns Evening on and sends. The editor is S1-25's; this uses it. */
async function answersIn(page: Page, code: string): Promise<void> {
  await expect(page.getByText("Times I'd actually be up for")).toBeVisible();
  await page.getByRole('group', { name: 'Days in this plan' }).getByRole('button').nth(1).click();
  await page.getByRole('checkbox', { name: /^Evening/ }).click();
  await page.getByRole('button', { name: 'Send my times' }).click();
  await expect(page).toHaveURL(new RegExp(`/j/${code}/sent$`));
  // Sent itself, as `sendEvenings` waits for: a hard navigation straight after
  // the client one, with Sent's requests in flight, crashes WebKit in CI.
  await expect(page.getByText(/Your times are in\./)).toBeVisible();
}

test('the organiser reviews, locks it in, and gets the message and the calendar file', async ({
  page,
}) => {
  const maya = await signedInAccount('Maya');
  const circleId = circleOwnedBy(maya.userId, 'Sunday Crew');
  const plan = planFor(circleId, maya.userId);
  const crew = { circleId, planId: plan.id, planCode: plan.code, ownerId: maya.userId, secret: '' };
  guestWhoAnswered(crew, 'Tom');
  guestInvited(crew, 'Alex');

  await page.addInitScript({
    content: `localStorage.setItem(${JSON.stringify(sessionStorageKey())}, ${JSON.stringify(maya.stored)});`,
  });
  await page.goto(`/j/${plan.code}`);
  await answersIn(page, plan.code);

  await page.goto(`/circles/${circleId}/plan/${plan.id}/candidates`);
  await page.getByRole('button', { name: /^Review / }).click();

  await expect(page.getByText('Lock it in?')).toBeVisible();
  await expect(page.getByText(/^Alex hasn't replied\./)).toBeVisible();
  const lockIn = page.getByRole('button', { name: 'Lock it in' });
  // The survey is required, so the button waits for it.
  await expect(lockIn).toHaveAttribute('aria-disabled', 'true');
  await page.getByLabel('Where it is').fill('Hope St Radio');
  await page.getByRole('checkbox', { name: 'One person' }).click();
  await lockIn.click();

  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/plan/${plan.id}/confirmed$`));
  await expect(page.getByText('Ready to paste into the group chat')).toBeVisible();
  await expect(page.getByText(/^Locked in: Sunday Crew, .* at Hope St Radio\./)).toBeVisible();
  await expect(page.getByText("Alex hasn't said yet")).toBeVisible();
  expect(confirmationOf(plan.id)).toEqual({ placeName: 'Hope St Radio', chased: 'one' });

  await page.getByRole('button', { name: 'Add to my calendar' }).click();
  await expect(
    page.getByText("Nothing is added to anyone's calendar without their tap."),
  ).toBeVisible();
  await expect(page.getByText(/Google/)).toHaveCount(0);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /^Apple or device calendar/ }).click();
  expect((await download).suggestedFilename()).toMatch(/^sunday-crew-\d{4}-\d{2}-\d{2}\.ics$/);
});

test("a member lands on the confirmed screen from the plan link and says they can't make it", async ({
  page,
}) => {
  const crew = sundayCrew();
  guestWhoAnswered(crew, 'Tom');

  // Ren is new: joins from the plan link and answers, which runs the engine.
  await page.goto(`/p/${crew.planCode}`);
  await page.getByRole('button', { name: "I'm new here" }).click();
  await page.getByLabel('Your name').fill('Ren');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(new RegExp(`/j/${crew.planCode}$`));
  await answersIn(page, crew.planCode);
  const ren = memberNamed(crew.circleId, 'Ren')?.userId ?? '';
  expect(ren).not.toBe('');

  lockInFirstOption(crew.planId, crew.ownerId);

  await page.goto(`/p/${crew.planCode}`);
  await expect(page).toHaveURL(new RegExp(`/p/${crew.planCode}/confirmed$`));
  await expect(page.getByText("You're going")).toBeVisible();
  await expect(page.getByRole('button', { name: 'Share to group chat' })).toHaveCount(0);

  await page.getByRole('button', { name: "I can't make it after all" }).click();
  await expect(page.getByText("You can't make it")).toBeVisible();
  expect(attendanceStatusOf(crew.planId, ren)).toBe('cant');

  await page.getByRole('button', { name: 'I can make it' }).click();
  await expect(page.getByText("You're going")).toBeVisible();
  expect(attendanceStatusOf(crew.planId, ren)).toBe('going');
});
