import { expect, test } from './fixtures';
import { addressFor, joinsAndAnswers, subscribesFromSent } from './journeys';
import { letterTo, linkIn } from './mail';
import {
  answerOf,
  guestWhoAnswered,
  lockInFirstOption,
  memberNamed,
  responderIds,
  stackConfig,
  sundayCrew,
} from './stack';

/**
 * Getting back in (spec §5.1, §6.3; S1-24, S1-30): a guest has no account, so
 * the session in this browser is the only thing that says who they are, and it
 * is lost all the time — Safari's seven idle days, the chat opening the link in
 * a different in-app browser than last time, a new phone. Two ways back, and
 * each ends with the answer they gave still theirs.
 *
 * Every test's page is a fresh browser context: nothing in storage.
 */

/**
 * Records whether "Which one is you?" was ever on screen, not only whether it
 * is gone by the time the test looks. A string, because it runs in the page and
 * the test project is compiled without the DOM library.
 */
const WATCH_FOR_THE_LIST = `new MutationObserver(() => {
  if (document.body && document.body.innerText.includes('Which one is you?')) window.sawList = true;
}).observe(document, { subtree: true, childList: true, characterData: true });`;

test('with storage cleared, the plan link offers the guests by name and one tap restores the answer', async ({
  page,
}) => {
  const crew = sundayCrew();
  const tom = guestWhoAnswered(crew, 'Tom');
  expect(answerOf(crew.planId, tom)?.status).toBe('flexible');

  await page.goto(`/p/${crew.planCode}`);

  await expect(page.getByText('Welcome back. Which one is you?')).toBeVisible();
  const tomsRow = page.getByRole('button', { name: 'Continue as Tom' });
  await expect(tomsRow).toBeVisible();
  // Guests only: Maya has a saved place and can never be reattached to (ADR 0006).
  await expect(page.getByRole('button', { name: 'Continue as Maya' })).toHaveCount(0);

  await tomsRow.click();
  await expect(page.getByText('Welcome back. Which one is you?')).toHaveCount(0);

  // The membership and its answer moved to this browser's new identity…
  const now = memberNamed(crew.circleId, 'Tom');
  expect(now?.userId).not.toBe(tom);
  expect(now?.anonymous).toBe(true);
  expect(responderIds(crew.planId)).toEqual([now?.userId]);
  expect(answerOf(crew.planId, now!.userId)?.status).toBe('flexible');

  // …and the editor opens on it, rather than on a blank answer.
  await page.goto(`/j/${crew.planCode}`);
  await expect(page.getByRole('switch', { name: "I'm easy" })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

test('the "Get back in" link in a real email restores access without the list, once', async ({
  page,
  browser,
  baseURL,
}) => {
  const crew = sundayCrew();
  guestWhoAnswered(crew, 'Tom');
  const address = addressFor('ren');

  // Ren answers, asks for updates and verifies from the email the stack sent.
  const ren = await joinsAndAnswers(page, crew, 'Ren');
  await subscribesFromSent(page, address);

  // Maya locks it in; the dispatcher sends Ren the news, with the way back in
  // in its footer.
  lockInFirstOption(crew.planId, crew.ownerId);
  const letter = await letterTo(address, /^Locked in: Sunday Crew/);
  const link = linkIn(letter, '/a', baseURL!);

  // Opened on another phone: nothing stored, no session.
  const phone = await browser.newContext();
  const other = await phone.newPage();
  await other.addInitScript({ content: WATCH_FOR_THE_LIST });
  await other.goto(link);

  // A plan that is not asking any more has nothing to answer, so the way back
  // in lands on the circle, with the meetup on it.
  await expect(other).toHaveURL(new RegExp(`/circles/${crew.circleId}$`));
  await expect(other.getByRole('heading', { name: 'Sunday Crew' })).toBeVisible();
  await expect(other.getByText('Locked in', { exact: true })).toBeVisible();
  expect(await other.evaluate('window.sawList === true'), 'the list never showed').toBe(false);
  const now = memberNamed(crew.circleId, 'Ren');
  expect(now?.userId, 'Ren, under this browser’s identity').not.toBe(ren);
  expect(responderIds(crew.planId)).toContain(now?.userId);
  await phone.close();

  // Single use: the same link again, in yet another browser, says so neutrally.
  const third = await (await browser.newContext()).newPage();
  await third.goto(link);
  await expect(third.getByText('This link has expired.')).toBeVisible();
});

test('times waiting on the phone go when the person comes back to the tab', async ({ page }) => {
  // SUS-41's gap 1 said the listener was on the wrong target: `visibilitychange`
  // fires on `document`, and the page listens on `window`. It bubbles (HTML
  // §"update the visibility state"), so `window` hears it — this pins that.
  const crew = sundayCrew();
  await page.goto(`/j/${crew.planCode}`);
  await page.getByLabel('Your name').fill('Ren');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText("Times I'd actually be up for")).toBeVisible();
  const ren = memberNamed(crew.circleId, 'Ren')!.userId;

  const api = `${stackConfig().apiUrl}/**`;
  await page.route(api, (route) => route.abort('internetdisconnected'));
  await page.getByRole('group', { name: 'Days in this plan' }).getByRole('button').first().click();
  await page.getByRole('checkbox', { name: /^Evening/ }).click();
  await page.getByRole('button', { name: 'Send my times' }).click();
  await expect(page.getByText('Your times are saved on this phone.')).toBeVisible();
  expect(answerOf(crew.planId, ren)).toBeUndefined();

  await page.unroute(api);
  // Exactly what the browser does on coming back: the event, at the document.
  await page.evaluate(`document.dispatchEvent(new Event('visibilitychange', { bubbles: true }))`);

  await expect(page).toHaveURL(new RegExp(`/j/${crew.planCode}/sent$`));
  expect(answerOf(crew.planId, ren)?.windows).toHaveLength(1);
});
