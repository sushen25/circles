import { expect, test, type Page } from './fixtures';
import { addressFor, joinsAndAnswers, sendEvenings } from './journeys';
import { asksFromTheForm } from './quiet-people';
import { guestWhoAnswered, latestCodeFor, memberNamed, plansIn, sql, sundayCrew } from './stack';

/**
 * Guest → saved place (S2-07, spec §5.11): the prompts appear only after the
 * thing they would have helped with, and the organiser gate keeps the place a
 * guest already has — on plan setup, and on the quiet ask's door (S2-08).
 *
 * Each test's page is a fresh browser context: nothing in storage.
 */

/** Every words any of the prompts or the gate would put on screen. */
const PROMPTS = [
  'Save your place first',
  'Keep your place for good?',
  'Got another group that keeps saying “we should catch up”?',
  'Get the app',
];

async function expectNoPrompt(page: Page): Promise<void> {
  for (const words of PROMPTS) await expect(page.getByText(words)).toHaveCount(0);
}

/** Requests to `record-nudge` this page has made so far. */
function nudgeRequests(page: Page): string[] {
  const asked: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.endsWith('/functions/v1/record-nudge')) {
      asked.push(request.postData() ?? '');
    }
  });
  return asked;
}

test('no prompt of any kind on Join, Name or Availability: nothing is even asked until the answer is in', async ({
  page,
}) => {
  const crew = sundayCrew();
  const asked = nudgeRequests(page);

  await page.goto(`/join#${crew.secret}`);
  await expect(page.getByText('Sunday Crew is finding a time to catch up.')).toBeVisible();
  await expectNoPrompt(page);

  await page.getByRole('button', { name: 'Choose my times' }).click();
  await expect(page.getByLabel('Your name')).toBeVisible();
  await expectNoPrompt(page);
  await page.getByLabel('Your name').fill('Priya');
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page).toHaveURL(new RegExp(`/j/${crew.planCode}$`));
  await expect(page.getByText("Times I'd actually be up for")).toBeVisible();
  await expectNoPrompt(page);
  expect(asked, 'no prompt was asked about before the answer').toEqual([]);

  // After the answer, the email card is the first thing that may be offered,
  // and it is asked about as the Times-sent moment.
  await sendEvenings(page, crew.planCode);
  await expect(page.getByText('Get updates about this meetup by email')).toBeVisible();
  expect(asked.map((body) => (JSON.parse(body) as { moment: string }).moment)).toEqual([
    'sent_save_access',
  ]);
});

test('a guest who meets the organiser gate keeps their membership and name, and makes the plan', async ({
  page,
}) => {
  const crew = sundayCrew();
  const priya = await joinsAndAnswers(page, crew, 'Priya');
  // Maya's plan is called off, so the circle is free for somebody else's.
  sql(`select planning.transition_plan('${crew.planId}', 'cancel', '${crew.ownerId}', '{}')`);

  await page.goto(`/circles/${crew.circleId}`);
  // A circle that has never met offers its first catch-up.
  await page.getByRole('button', { name: /^Plan (a|the first) catch-up$/ }).click();
  const planning = new RegExp(`/circles/${crew.circleId}/plan/(setup|new)$`);
  await expect(page).toHaveURL(planning);

  // The gate is drawn in place of the form, and says whose place it keeps.
  await expect(page.getByText('Save your place first')).toBeVisible();
  await expect(
    page.getByText("This links your existing place as Priya. Nothing you've sent changes."),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ask the group' })).toHaveCount(0);

  const address = addressFor('priya');
  await page.getByRole('button', { name: 'Continue with email' }).click();
  await page.getByLabel('Your email').fill(address);
  await page.getByRole('button', { name: 'Send me a code' }).click();
  await page.getByLabel('Code', { exact: true }).fill(await latestCodeFor(address));
  await page.getByRole('button', { name: 'Continue' }).click();

  // Saved, the form the gate stood in for is the screen, on the same URL.
  await expect(page.getByRole('button', { name: 'Ask the group' })).toBeVisible();
  await expect(page).toHaveURL(planning);

  // The same membership, under the same name — now a saved place.
  expect(memberNamed(crew.circleId, 'Priya')).toEqual({ userId: priya, anonymous: false });
  await expect
    .poll(
      () => sql(`select display_name from public.profiles where user_id = '${priya}'`)[0]?.[0],
      { message: 'the profile has the name the circle knows her by' },
    )
    .toBe('Priya');
  const [claimed] = sql(`select metadata ->> 'moment' from private.audit_log
    where action = 'growth.account_claimed' and resource_id = '${priya}'`);
  expect(claimed?.[0]).toBe('organiser_gate');

  await page.getByRole('button', { name: 'Ask the group' }).click();
  await expect(page).toHaveURL(new RegExp(`/circles/${crew.circleId}/plan/[^/]+/shared$`));
  const made = plansIn(crew.circleId).find((plan) => plan.state === 'collecting');
  expect(made, 'a plan is finding a time').toBeDefined();
  const [organiser] = sql(`select organiser_user_id from public.plans where id = '${made!.id}'`);
  expect(organiser?.[0], 'and Priya organises it').toBe(priya);
});

test('"Keep your place for good?" follows a Continue-as from the list, once, and "Carry on" is the page', async ({
  page,
  browser,
}) => {
  const crew = sundayCrew();
  guestWhoAnswered(crew, 'Tom');

  await page.goto(`/p/${crew.planCode}`);
  await page.getByRole('button', { name: 'Continue as Tom' }).click();
  await expect(page.getByText('Welcome back, Tom.')).toBeVisible();
  await expect(page.getByText('Keep your place for good?')).toBeVisible();
  await page.getByRole('button', { name: 'Carry on to Sunday Crew' }).click();
  await expect(page.getByText('Keep your place for good?')).toHaveCount(0);
  const tom = memberNamed(crew.circleId, 'Tom')!;
  await expect
    .poll(() => {
      const [row] = sql(`select answer from public.nudge_states
        where user_id = '${tom.userId}' and moment = 'reattached_save_place'`);
      return row?.[0];
    })
    .toBe('dismissed');

  // The next browser: the list again, and the prompt's record came with the
  // membership, so it is not asked a second time.
  const again = await browser.newContext();
  const second = await again.newPage();
  await second.goto(`/p/${crew.planCode}`);
  // Armed before the tap: the answer can arrive before a wait set up after it.
  const answered = second.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith('/functions/v1/record-nudge'),
  );
  await second.getByRole('button', { name: 'Continue as Tom' }).click();
  await expect(second.getByText('Welcome back. Which one is you?')).toHaveCount(0);
  // Once `record-nudge` has answered, not merely before it has.
  await answered;
  await expectNoPrompt(second);
  await again.close();
});

test('a guest who taps "See if people are keen" meets the gate, keeps their place, and the quiet ask is theirs', async ({
  page,
}) => {
  const crew = sundayCrew();
  const priya = await joinsAndAnswers(page, crew, 'Priya');
  sql(`select planning.transition_plan('${crew.planId}', 'cancel', '${crew.ownerId}', '{}')`);

  // ChooseMode's quiet door is a tap, so the gate is drawn in place of the
  // cards and the tap goes on once the place is saved.
  await page.goto(`/circles/${crew.circleId}/plan/mode`);
  await page.getByRole('button', { name: /^See if people are keen\./ }).click();
  await expect(page.getByText('Save your place first')).toBeVisible();
  await expect(
    page.getByText("This links your existing place as Priya. Nothing you've sent changes."),
  ).toBeVisible();

  const address = addressFor('priya');
  await page.getByRole('button', { name: 'Continue with email' }).click();
  await page.getByLabel('Your email').fill(address);
  await page.getByRole('button', { name: 'Send me a code' }).click();
  await page.getByLabel('Code', { exact: true }).fill(await latestCodeFor(address));
  await page.getByRole('button', { name: 'Continue' }).click();

  // The tap she made is the tap that happens: SparkSetup, then her ask.
  await expect(page).toHaveURL(new RegExp(`/circles/${crew.circleId}/quiet/new$`));
  await asksFromTheForm(page);
  await expect(page).toHaveURL(new RegExp(`/circles/${crew.circleId}/quiet/[0-9a-f-]{36}$`));
  await expect(page.getByRole('button', { name: 'Withdraw the ask' })).toBeVisible();

  // The same membership, a saved place now, credited to the gate — and the
  // ask hers, which only `private` knows.
  expect(memberNamed(crew.circleId, 'Priya')).toEqual({ userId: priya, anonymous: false });
  const [claimed] = sql(`select metadata ->> 'moment' from private.audit_log
    where action = 'growth.account_claimed' and resource_id = '${priya}'`);
  expect(claimed?.[0]).toBe('organiser_gate');
  const askId = page.url().split('/').at(-1)!;
  expect(
    sql(`select initiator_user_id from private.plan_initiators where plan_id = '${askId}'`),
  ).toEqual([[priya]]);
});
