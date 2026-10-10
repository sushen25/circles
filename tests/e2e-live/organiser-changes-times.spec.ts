import { expect, test, type Page } from './fixtures';
import { days, sendEvenings } from './journeys';

import {
  circleOwnedBy,
  guestInvited,
  guestWhoAnswered,
  planFor,
  sessionStorageKey,
  signedInAccount,
  type Scenario,
} from './stack';

/**
 * The organiser changes their own times (SUS-158): from Waiting and from the
 * options, in the editor a member has, back where they came from, with the
 * options read again. What the unit tests cannot show is the chain: the editor
 * opens on the stored answer, the send replaces it, and the screen they land on
 * is built from the recalculation that send ran.
 */

async function organiserWhoAnswered(page: Page, others: (crew: Scenario) => void, answers = true) {
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
  others(crew);
  await page.addInitScript({
    content: `localStorage.setItem(${JSON.stringify(sessionStorageKey())}, ${JSON.stringify(maya.stored)});`,
  });
  if (answers) {
    await page.goto(`/j/${plan.code}`);
    await sendEvenings(page, plan.code, 1);
  }
  return { circleId, plan, here: `/circles/${circleId}/plan/${plan.id}/candidates` };
}

/** The editor, opened on what was sent: day 1 ticked. Moves the answer to day 2. */
async function movesToDay(page: Page, code: string, day: number): Promise<void> {
  await expect(page.getByText("Times I'd actually be up for")).toBeVisible();
  // Prefilled: the stored answer is on the grid, not a blank one.
  await expect(page.getByText(/^1 of \d+ days$/)).toBeVisible();
  await page.getByRole('button', { name: /^Start over/ }).click();
  await days(page).nth(day).click();
  await page.getByRole('checkbox', { name: /^Evening/ }).click();
  await page.getByRole('button', { name: 'Send my times' }).click();
  // Not the sent screen: back on the screen they came from.
  await expect(page).not.toHaveURL(new RegExp(`/j/${code}`));
}

test('the organiser changes their times from the options, and the options follow', async ({
  page,
}) => {
  const { plan, here } = await organiserWhoAnswered(page, (crew) => {
    guestWhoAnswered(crew, 'Tom');
    guestInvited(crew, 'Alex');
  });

  await page.goto(here);
  await expect(page.getByText(/looks good for two of you\./)).toBeVisible();
  const before = await page
    .getByRole('button', { name: /Best attendance/ })
    .first()
    .innerText();

  await page.getByRole('button', { name: 'Change my times' }).click();
  await expect(page).toHaveURL(new RegExp(`/j/${plan.code}`));
  await movesToDay(page, plan.code, 2);

  await expect(page).toHaveURL(new RegExp(`/candidates$`));
  await expect(page.getByText(/looks good for two of you\./)).toBeVisible();
  await expect
    .poll(async () =>
      page
        .getByRole('button', { name: /Best attendance/ })
        .first()
        .innerText(),
    )
    .not.toBe(before);
});

test('the organiser opens their times from the waiting screen, and lands back on it', async ({
  page,
}) => {
  // Nobody has answered, the organiser included: the editor is theirs to open
  // from here, and what they send is what turns waiting into something.
  const { plan, here } = await organiserWhoAnswered(
    page,
    (crew) => {
      guestInvited(crew, 'Tom');
      guestInvited(crew, 'Alex');
    },
    false,
  );

  await page.goto(here);
  await expect(page.getByText('Waiting on the first reply.')).toBeVisible();
  await page.getByRole('button', { name: 'Change my times' }).click();
  await expect(page).toHaveURL(new RegExp(`/j/${plan.code}`));
  await expect(page.getByText("Times I'd actually be up for")).toBeVisible();
  await days(page).nth(2).click();
  await page.getByRole('checkbox', { name: /^Evening/ }).click();
  await page.getByRole('button', { name: 'Send my times' }).click();

  await expect(page).toHaveURL(new RegExp(`/candidates$`));
  await expect(page.getByText('Waiting on the first reply.')).toHaveCount(0);
  await expect(page.getByText('1 of 3 replied')).toBeVisible();
});

test('the organiser changes their times from the no-overlap screen too', async ({ page }) => {
  // A quorum of two, both answered, and Tom has no time that works: the plan
  // has really missed, and the closest it got is the organiser's own. (Alone in
  // the circle it would still be waiting, not missed: SUS-193.)
  const { plan, here } = await organiserWhoAnswered(page, (crew) => {
    guestWhoAnswered(crew, 'Tom', 'none_work');
  });

  await page.goto(here);
  await expect(page.getByText("There wasn't enough overlap this time.")).toBeVisible();
  await page.getByRole('button', { name: 'Change my times' }).click();
  await movesToDay(page, plan.code, 2);

  await expect(page).toHaveURL(new RegExp(`/candidates$`));
  await expect(page.getByText("There wasn't enough overlap this time.")).toBeVisible();
});
