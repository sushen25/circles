// @e2e: core
import { expect, test } from './fixtures';
import { joinsAndAnswers } from './journeys';
import { guestWhoAnswered, memberNamed, sundayCrew } from './stack';

/**
 * The guest path, redesigned (SUS-250, ADR 0092): a guest's pick from the list
 * asks first, and the chat link of somebody who has answered opens on how
 * things stand instead of on the editor.
 */

test("a guest's pick moves nothing until Yes, and Not me returns focus to the name", async ({
  page,
}) => {
  const crew = sundayCrew();
  const tomAsGuest = guestWhoAnswered(crew, 'Tom');

  await page.goto(`/p/${crew.planCode}`);
  await expect(page.getByText('Been here before?')).toBeVisible();
  await expect(page.getByText('Tap your name to carry on.')).toBeVisible();
  // Nothing on this screen claims what the product does not do.
  await expect(page.getByText(/can see when someone rejoins/)).toHaveCount(0);

  const tom = page.getByRole('button', { name: 'Continue as Tom' });
  await tom.click();
  await expect(page.getByText('Carry on as Tom?')).toBeVisible();
  await expect(page.getByText("Tom's times in Sunday Crew come to this phone.")).toBeVisible();
  expect(memberNamed(crew.circleId, 'Tom')?.userId, 'nothing moved on the tap').toBe(tomAsGuest);

  // Escape closes it, sends nothing, and puts focus back on the name.
  // Pressed until it takes: focus moves into the sheet a moment after it opens.
  await expect(async () => {
    await page.keyboard.press('Escape');
    await expect(page.getByText('Carry on as Tom?')).toHaveCount(0, { timeout: 1_500 });
  }).toPass();
  await expect(tom).toBeFocused();
  expect(memberNamed(crew.circleId, 'Tom')?.userId, 'nothing moved on Escape').toBe(tomAsGuest);

  await tom.click();
  await page.getByRole('button', { name: 'Not me' }).click();
  await expect(page.getByText('Carry on as Tom?')).toHaveCount(0);
  await expect(tom).toBeFocused();
  expect(memberNamed(crew.circleId, 'Tom')?.userId, 'nothing moved on Not me').toBe(tomAsGuest);

  await tom.click();
  await page.getByRole('button', { name: "Yes, I'm Tom" }).click();
  await expect(page.getByText('Been here before?')).toHaveCount(0);
  expect(memberNamed(crew.circleId, 'Tom')?.userId, 'moved on Yes').not.toBe(tomAsGuest);
});

test('the chat link of somebody who has answered opens on how it is looking, and Change my times opens the editor', async ({
  page,
}) => {
  const crew = sundayCrew();
  await joinsAndAnswers(page, crew, 'Ren', 1, 3);

  await page.goto(`/j/${crew.planCode}`);
  await expect(page.getByText('Your times are in.')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/p/${crew.planCode}`));
  // With nobody else's times yet, the page waits rather than offering options.
  await expect(page.getByText('Waiting on a few more.')).toBeVisible();
  await expect(page.getByText('Which evenings could work?')).toHaveCount(0);

  await page.getByRole('button', { name: 'Change my times' }).click();
  await expect(page.getByText('Which evenings could work?')).toBeVisible();
  // The answer as it was, not a blank grid.
  await expect(
    page.getByRole('group', { name: 'Days in this plan' }).getByRole('button').nth(1),
  ).toHaveAttribute('aria-pressed', 'true');
});

test('Sent gives the reward first: the days sent, what happens next, and a way to the options', async ({
  page,
}) => {
  const crew = sundayCrew();
  await joinsAndAnswers(page, crew, 'Ren', 1, 3);

  await expect(page.getByText('Thanks, Ren. Your times are in.')).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'The days you sent' }).getByRole('listitem'),
  ).toHaveCount(2);
  await expect(page.getByText(/^Maya picks a time once replies close /)).toBeVisible();
  await expect(page.getByText("Hear when it's locked in?")).toBeVisible();
  await expect(
    page.getByText(
      'Makes you an account, so any phone gets you back in. Reminders to plan the next one can be stopped from the email.',
    ),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Email me and save my place' })).toBeVisible();
  await expect(page.getByText(/doesn't subscribe you/)).toHaveCount(0);

  await page.getByRole('button', { name: "See how it's looking" }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${crew.planCode}`));
});

test('Send says why when nothing is tapped', async ({ page }) => {
  const crew = sundayCrew();
  await page.goto(`/j/${crew.planCode}`);
  await page.getByLabel('Your first name').fill('Ren');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Which evenings could work?')).toBeVisible();

  await page.getByRole('button', { name: 'Send my times' }).click({ force: true });
  await expect(page.getByText('Tap at least one evening first.')).toBeVisible();
});
