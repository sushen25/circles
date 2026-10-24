// @e2e: in-app-browser, locale
import { expect, test, type Page } from './fixtures';

import {
  guestWhoAnswered,
  letTheQuorumFollow,
  quorumOf,
  responderIds,
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
 * or an account picks returning or new (an account's "new" is one tap), a circle with nobody to be
 * skips the question. Each test ends in the database, because the screens after
 * a join are still fixtures until S1-25.
 */

/**
 * Records whether "Been here before?" was ever on screen, not just whether it
 * is gone by the time the test looks. A string, because this runs in the page
 * and the test project has no DOM library.
 */
async function watchForTheList(page: Page): Promise<void> {
  await page.addInitScript({
    content: `new MutationObserver(() => {
      if (document.body && document.body.innerText.includes('Been here before?')) window.sawList = true;
    }).observe(document, { subtree: true, childList: true, characterData: true });`,
  });
}

async function typeName(page: Page, name: string): Promise<void> {
  await page.getByLabel('Your first name').fill(name);
  await page.getByRole('button', { name: 'Continue' }).click();
}

test('a stranger taps "I\'m new here", gives a name, and is a guest the plan is asking', async ({
  page,
}) => {
  const crew = sundayCrew();
  guestWhoAnswered(crew, 'Tom');

  await page.goto(`/p/${crew.planCode}`);
  await expect(page.getByText('Been here before?')).toBeVisible();
  await page.getByRole('button', { name: "I'm new here" }).click();
  await typeName(page, 'Ren');

  await expect(page).toHaveURL(new RegExp(`/j/${crew.planCode}$`));
  const ren = memberNamed(crew.circleId, 'Ren');
  expect(ren, 'Ren is a member of Sunday Crew').toBeDefined();
  expect(ren?.anonymous, 'as a guest').toBe(true);
  expect(isParticipant(crew.planId, ren!.userId), 'and somebody the plan is asking').toBe(true);
});

test('a circle with no guests never asks "Been here before?"', async ({ page }) => {
  // Maya, the owner, has a saved place, so there is nobody to continue as.
  const crew = sundayCrew();
  await watchForTheList(page);

  await page.goto(`/j/${crew.planCode}`);
  await expect(page.getByText('What should the group call you?')).toBeVisible();
  // SUS-203: the effort and the privacy line, before anything is typed.
  await expect(page.getByText('About a minute, and nobody sees your calendar.')).toBeVisible();
  await typeName(page, 'Ren');

  // The name step and the editor share this URL, so the URL alone does not say
  // the join has landed; the editor's heading does. Reading the database before
  // it appears raced the join (SUS-86, once `sql()` stopped taking a second).
  await expect(page).toHaveURL(new RegExp(`/j/${crew.planCode}$`));
  await expect(page.getByText('Which evenings could work?')).toBeVisible();
  expect(memberNamed(crew.circleId, 'Ren')).toBeDefined();
  expect(await page.evaluate('window.sawList === true')).toBe(false);
});

test('Back from the name step stays on the plan link, whichever Back is pressed', async ({
  page,
}) => {
  // Found on 14 Oct 2026: a mistyped name and a tap on Back landed on `/`, the
  // marketing site, and the guest had to find the link in the chat again.
  const crew = sundayCrew();
  guestWhoAnswered(crew, 'Tom');
  const onThePlanLink = new RegExp(`/[jp]/${crew.planCode}$`);

  await page.goto(`/p/${crew.planCode}`);
  await page.getByRole('button', { name: "I'm new here" }).click();
  await expect(page.getByText('What should the group call you?')).toBeVisible();
  await page.getByLabel('Your first name').fill('Rne');

  // The top bar's arrow returns to the step before: "Been here before?".
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByText('Been here before?')).toBeVisible();
  await expect(page).toHaveURL(onThePlanLink);

  // The browser's Back does the same.
  await page.getByRole('button', { name: "I'm new here" }).click();
  await expect(page.getByText('What should the group call you?')).toBeVisible();
  await page.goBack();
  await expect(page.getByText('Been here before?')).toBeVisible();
  await expect(page).toHaveURL(onThePlanLink);
});

test('with nobody to continue as, the arrow stays on the plan link and the browser goes back to where the link came from', async ({
  page,
}) => {
  // The name step is the plan link's landing here, so there is no step before
  // it to return to. The top bar's arrow stays on the link (and empties the
  // field); the browser's Back is the browser's: the page the guest came from,
  // which is the chat for a link tapped there, and never the website's `/`.
  const crew = sundayCrew();
  const onThePlanLink = new RegExp(`/[jp]/${crew.planCode}$`);

  await page.goto('about:blank');
  await page.goto(`/j/${crew.planCode}`);
  await expect(page.getByText('What should the group call you?')).toBeVisible();
  const field = page.getByLabel('Your first name');
  await field.fill('Rne');

  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page).toHaveURL(onThePlanLink);
  await expect(page.getByText('What should the group call you?')).toBeVisible();
  await expect(field).toHaveValue('');

  await page.goBack();
  await expect(page).toHaveURL('about:blank');
});

test('an account that is not a member is shown the guests, and "I\'m new here" joins it as itself', async ({
  page,
}) => {
  const crew = sundayCrew();
  guestWhoAnswered(crew, 'Tom');
  const sam = await signedInAccount('Sam');
  await page.addInitScript({
    content: `localStorage.setItem(${JSON.stringify(sessionStorageKey())}, ${JSON.stringify(sam.stored)});`,
  });

  await page.goto(`/p/${crew.planCode}`);
  // The same list a guest gets (ADR 0088), without "I have an account".
  await expect(page.getByRole('button', { name: 'Continue as Tom' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'I have an account' })).toHaveCount(0);

  await page.getByRole('button', { name: "I'm new here" }).click();
  const join = page.getByRole('button', { name: 'Join Sunday Crew as Sam' });
  await expect(join).toBeVisible();
  await expect(page.getByLabel('Your first name'), 'one tap, not the name step').toHaveCount(0);
  await join.click();

  await expect(page).toHaveURL(new RegExp(`/j/${crew.planCode}$`));
  const member = memberNamed(crew.circleId, 'Sam');
  expect(member?.userId, 'the account itself, not a new guest').toBe(sam.userId);
  expect(member?.anonymous).toBe(false);
  expect(isParticipant(crew.planId, sam.userId)).toBe(true);
  expect(memberNamed(crew.circleId, 'Tom')?.anonymous, 'Tom is still a guest').toBe(true);
});

test("an account takes a guest's place, with its answer, even once the plan has stopped asking", async ({
  page,
}) => {
  // SUS-245: Tom answered as a guest, then signed up. On a plan past its deadline
  // join-plan admits nobody, and the account used to end at "ask for the invite
  // link" while a guest on the same link could still pick Tom.
  const crew = sundayCrew();
  const tomAsGuest = guestWhoAnswered(crew, 'Tom');
  planStopsAsking(crew, 'deadline_passed');
  const tom = await signedInAccount('Tom Signed Up');
  await page.addInitScript({
    content: `localStorage.setItem(${JSON.stringify(sessionStorageKey())}, ${JSON.stringify(tom.stored)});`,
  });

  await page.goto(`/p/${crew.planCode}`);
  await page.getByRole('button', { name: 'Continue as Tom' }).click();

  // Nothing moves on the tap: the account is asked first, and "Not me" sends nothing.
  await expect(page.getByText("Take Tom's place in Sunday Crew?")).toBeVisible();
  expect(memberNamed(crew.circleId, 'Tom')?.anonymous, 'still the guest').toBe(true);
  await page.getByRole('button', { name: 'Not me' }).click();
  await expect(page.getByText("Take Tom's place in Sunday Crew?")).toHaveCount(0);
  expect(memberNamed(crew.circleId, 'Tom')?.userId, 'nothing moved').toBe(tomAsGuest);
  await page.getByRole('button', { name: 'Continue as Tom' }).click();
  await page.getByRole('button', { name: "Yes, I'm Tom" }).click();

  await expect(page.getByText('Been here before?')).toHaveCount(0);
  await expect(page.getByText("This plan isn't taking new answers.")).toHaveCount(0);
  const member = memberNamed(crew.circleId, 'Tom');
  expect(member?.userId, "the place is the account's now").toBe(tom.userId);
  expect(member?.anonymous).toBe(false);
  expect(responderIds(crew.planId), 'and the answer came with it').toContain(tom.userId);
  expect(responderIds(crew.planId)).not.toContain(tomAsGuest);
});

test('a plan that is not asking ends at one place, and a link that is not live at another', async ({
  browser,
}) => {
  // A plan past its deadline is still live (ADR 0049): the person gives a name and
  // is told whom to ask (ADR 0091). A cancelled plan, a quiet ask still gathering
  // interest and a code that does not exist are not live, and share one end state
  // with no name step: "this link isn't active". The server refuses all four
  // joins with one `invite_inactive`, and nothing is let in either way.
  const live: string[] = [];
  const dead: string[] = [];

  for (const how of ['deadline_passed', 'cancelled', 'quiet_ask', 'no_such_plan'] as const) {
    const crew = sundayCrew();
    const code = how === 'no_such_plan' ? 'zzzzzzzzzz' : crew.planCode;
    if (how !== 'no_such_plan') planStopsAsking(crew, how);

    // A fresh browser each time: nothing carried from the last one.
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`/j/${code}`);

    if (how === 'deadline_passed') {
      await typeName(page, 'Ada');
      await expect(page.getByText("This plan isn't taking new answers."), how).toBeVisible();
      await expect(page.getByText('Ask someone in Sunday Crew to add you.'), how).toBeVisible();
      // Never told about a link they have not seen (ADR 0091).
      await expect(page.getByText(/invite link/i), how).toHaveCount(0);
      live.push(await page.locator('body').innerText());
    } else {
      await expect(page.getByText("This link isn't active any more."), how).toBeVisible();
      await expect(page.getByLabel('Your first name'), `${how} asks for no name`).toHaveCount(0);
      dead.push(await page.locator('body').innerText());
    }
    if (how !== 'no_such_plan') {
      expect(memberNamed(crew.circleId, 'Ada'), `${how} let nobody in`).toBeUndefined();
    }
    await context.close();
  }

  expect(live).toHaveLength(1);
  expect(new Set(dead).size, 'one end state for every link that is not live').toBe(1);
});

test('somebody who joins by invite after the plan was made is asked by it on arrival', async ({
  page,
}) => {
  // The gap SUS-41 recorded: joining the circle adds nobody to a plan already
  // running, so an invitee landed on the plan and `replace_response` refused
  // their answer. ADR 0022: opening the plan's link asks them.
  const crew = sundayCrew();

  await page.goto(`/join#${crew.secret}`);
  await page.getByRole('button', { name: 'Join Sunday Crew' }).click();
  await typeName(page, 'Nina');
  await expect(page).toHaveURL(new RegExp(`/j/${crew.planCode}$`));

  const nina = memberNamed(crew.circleId, 'Nina');
  expect(nina).toBeDefined();
  await expect.poll(() => isParticipant(crew.planId, nina!.userId)).toBe(true);
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
