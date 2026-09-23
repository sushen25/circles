import { expect, test, type Page } from '@playwright/test';

import {
  clearRateCounters,
  guestWhoAnswered,
  letTheQuorumFollow,
  quorumOf,
  revisionOf,
  isParticipant,
  memberNamed,
  planStopsAsking,
  sessionStorageKey,
  signedInAccount,
  sundayCrew,
} from './stack';

/**
 * Arriving on a plan link (ADR 0022, S1-24d).
 *
 * The link the group chat actually sees is the plan's, and it now lets people
 * in while the plan is asking. Who arrives decides what they are asked: a guest
 * picks returning or new, an account gets one tap, a circle with nobody to be
 * skips the question. Each test ends in the database, because the screens after
 * a join are still fixtures until S1-25.
 */

test.beforeEach(() => {
  clearRateCounters();
});

/**
 * Records whether "Which one is you?" was ever on screen, not just whether it
 * is gone by the time the test looks. A string, because this runs in the page
 * and the test project has no DOM library.
 */
async function watchForTheList(page: Page): Promise<void> {
  await page.addInitScript({
    content: `new MutationObserver(() => {
      if (document.body && document.body.innerText.includes('Which one is you?')) window.sawList = true;
    }).observe(document, { subtree: true, childList: true, characterData: true });`,
  });
}

async function typeName(page: Page, name: string): Promise<void> {
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Continue' }).click();
}

test('a stranger taps "I\'m new here", gives a name, and is a guest the plan is asking', async ({
  page,
}) => {
  const crew = sundayCrew();
  guestWhoAnswered(crew, 'Tom');

  await page.goto(`/p/${crew.planCode}`);
  await expect(page.getByText('Welcome back. Which one is you?')).toBeVisible();
  await page.getByRole('button', { name: "I'm new here" }).click();
  await typeName(page, 'Ren');

  await expect(page).toHaveURL(new RegExp(`/j/${crew.planCode}$`));
  const ren = memberNamed(crew.circleId, 'Ren');
  expect(ren, 'Ren is a member of Sunday Crew').toBeDefined();
  expect(ren?.anonymous, 'as a guest').toBe(true);
  expect(isParticipant(crew.planId, ren!.userId), 'and somebody the plan is asking').toBe(true);
});

test('a circle with no guests never asks "Which one is you?"', async ({ page }) => {
  // Maya, the owner, has a saved place, so there is nobody to continue as.
  const crew = sundayCrew();
  await watchForTheList(page);

  await page.goto(`/j/${crew.planCode}`);
  await expect(page.getByText('What should the group call you?')).toBeVisible();
  await typeName(page, 'Ren');

  // The name step and the editor share this URL, so the URL alone does not say
  // the join has landed; the editor's heading does. Reading the database before
  // it appears raced the join (SUS-86, once `sql()` stopped taking a second).
  await expect(page).toHaveURL(new RegExp(`/j/${crew.planCode}$`));
  await expect(page.getByText("Times I'd actually be up for")).toBeVisible();
  expect(memberNamed(crew.circleId, 'Ren')).toBeDefined();
  expect(await page.evaluate('window.sawList === true')).toBe(false);
});

test('an account that is not a member sees one button naming the circle and itself, and joins', async ({
  page,
}) => {
  const crew = sundayCrew();
  guestWhoAnswered(crew, 'Tom');
  const sam = await signedInAccount('Sam');
  await page.addInitScript({
    content: `localStorage.setItem(${JSON.stringify(sessionStorageKey())}, ${JSON.stringify(sam.stored)});`,
  });
  await watchForTheList(page);

  await page.goto(`/p/${crew.planCode}`);
  const join = page.getByRole('button', { name: 'Join Sunday Crew as Sam' });
  await expect(join).toBeVisible();
  await join.click();

  await expect(page).toHaveURL(new RegExp(`/j/${crew.planCode}$`));
  // Never a list: those are guests, and an account is nobody's guest.
  expect(await page.evaluate('window.sawList === true')).toBe(false);
  const member = memberNamed(crew.circleId, 'Sam');
  expect(member?.userId, 'the account itself, not a new guest').toBe(sam.userId);
  expect(member?.anonymous).toBe(false);
  expect(isParticipant(crew.planId, sam.userId)).toBe(true);
});

test('a plan that is not asking ends at the same place whatever the reason', async ({
  browser,
}) => {
  // A plan past its deadline, a cancelled one, a quiet ask still gathering
  // interest and a code that does not exist. The server refuses all four with
  // one `invite_inactive`, so the screen a newcomer ends on must be one screen.
  const ends: string[] = [];

  for (const how of ['deadline_passed', 'cancelled', 'quiet_ask', 'no_such_plan'] as const) {
    const crew = sundayCrew();
    const code = how === 'no_such_plan' ? 'zzzzzzzzzz' : crew.planCode;
    if (how !== 'no_such_plan') planStopsAsking(crew, how);

    // A fresh browser each time: nothing carried from the last one.
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`/j/${code}`);
    await typeName(page, 'Ada');

    await expect(page.getByText('You need the invite link to join.'), how).toBeVisible();
    ends.push(await page.locator('body').innerText());
    if (how !== 'no_such_plan') {
      expect(memberNamed(crew.circleId, 'Ada'), `${how} let nobody in`).toBeUndefined();
    }
    await context.close();
  }

  expect(new Set(ends).size, 'one end state for every plan that is not asking').toBe(1);
});

test('somebody who joins by invite after the plan was made is asked by it on arrival', async ({
  page,
}) => {
  // The gap SUS-41 recorded: joining the circle adds nobody to a plan already
  // running, so an invitee landed on the plan and `replace_response` refused
  // their answer. ADR 0022: opening the plan's link asks them.
  const crew = sundayCrew();

  await page.goto(`/join#${crew.secret}`);
  await page.getByRole('button', { name: 'Choose my times' }).click();
  await typeName(page, 'Priya');
  await expect(page).toHaveURL(new RegExp(`/j/${crew.planCode}$`));

  const priya = memberNamed(crew.circleId, 'Priya');
  expect(priya).toBeDefined();
  await expect.poll(() => isParticipant(crew.planId, priya!.userId)).toBe(true);
});

test('a quorum nobody chose follows the circle as people tap the link', async ({ page }) => {
  const crew = sundayCrew();
  // Five in, including the organiser: `soft_quorum(5)` is the floor, 3.
  for (const name of ['Tom', 'Jess', 'Sam', 'Kai']) guestWhoAnswered(crew, name);
  letTheQuorumFollow(crew.planId);
  expect(quorumOf(crew.planId)).toEqual({ quorum: 3, source: 'defaulted' });

  await page.goto(`/p/${crew.planCode}`);
  await page.getByRole('button', { name: "I'm new here" }).click();
  await typeName(page, 'Ren');
  await expect(page).toHaveURL(new RegExp(`/j/${crew.planCode}$`));

  // Six in: the majority passes the floor, so the number moves with it — and
  // nobody was asked again for it (ADR 0017).
  expect(quorumOf(crew.planId)).toEqual({ quorum: 4, source: 'defaulted' });
  expect(revisionOf(crew.planId)).toBe(1);
});

test('a quorum the organiser chose never moves by itself', async ({ page }) => {
  const crew = sundayCrew();
  for (const name of ['Tom', 'Jess', 'Sam', 'Kai']) guestWhoAnswered(crew, name);
  // The fixture's plan is made with a number in hand, which is what an
  // organiser setting one looks like.
  expect(quorumOf(crew.planId).source).toBe('chosen');
  const before = quorumOf(crew.planId).quorum;

  await page.goto(`/p/${crew.planCode}`);
  await page.getByRole('button', { name: "I'm new here" }).click();
  await typeName(page, 'Ren');
  await expect(page).toHaveURL(new RegExp(`/j/${crew.planCode}$`));

  expect(quorumOf(crew.planId)).toEqual({ quorum: before, source: 'chosen' });
});
