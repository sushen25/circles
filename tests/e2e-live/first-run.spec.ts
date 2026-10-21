// @e2e: in-app-browser
import { expect, test, type Page } from './fixtures';

import { signedInAs } from './journeys';
import {
  accountToSignInTo,
  circleOwnedBy,
  circlesOwnedBy,
  durationOf,
  guestWhoAnswered,
  isParticipant,
  latestCodeFor,
  memberNamed,
  plansIn,
  planFor,
  profileFor,
  quorumOf,
  sql,
  signedInAccount,
  sundayCrew,
} from './stack';

/**
 * The first run (S1-22, S1-22b, SUS-150; spec §5.1, §6.1): first circle → first
 * plan → Save your place (email → code) → name → the plan's share screen → the
 * organiser's own times → circle home. Nothing is created until the place is
 * saved (ADR 0053). Then the ways a returning organiser comes in, and
 * "I have an account" on a plan link (ADR 0022). Against the real stack: the
 * email code comes from the mail catcher, and every step ends in the database.
 */

/**
 * Counts every way a page can ask for a permission — geolocation, camera and
 * microphone, notifications, contacts, the Permissions API itself — plus any
 * `alert`/`confirm`/`prompt`. Recorded in the page, read back by the test.
 */
async function watchForPermissionAsks(page: Page): Promise<void> {
  await page.addInitScript({
    content: `
      window.permissionAsks = [];
      const note = (what) => window.permissionAsks.push(what);
      const wrap = (object, name, what) => {
        if (!object || typeof object[name] !== 'function') return;
        const original = object[name].bind(object);
        object[name] = (...args) => { note(what); return original(...args); };
      };
      wrap(navigator.geolocation, 'getCurrentPosition', 'geolocation');
      wrap(navigator.geolocation, 'watchPosition', 'geolocation');
      wrap(navigator.mediaDevices, 'getUserMedia', 'media');
      wrap(navigator.permissions, 'query', 'permissions');
      if (window.Notification) wrap(window.Notification, 'requestPermission', 'notifications');
      if (navigator.contacts) wrap(navigator.contacts, 'select', 'contacts');
    `,
  });
  page.on('dialog', (dialog) => {
    void page.evaluate(`window.permissionAsks.push('dialog:${dialog.type()}')`);
    void dialog.dismiss();
  });
}

/** Every text field on screen that a person could type into. */
async function typedFieldsOnScreen(page: Page): Promise<number> {
  return await page
    .locator('input:visible:not([readonly]), textarea:visible:not([readonly])')
    .count();
}

/** How many circles with this name exist at all: the abandoned draft's witness. */
function circleCountNamed(name: string): number {
  return Number(sql(`select count(*) from circles where name = '${name}'`)[0]?.[0] ?? 0);
}

async function draftThroughThePlan(page: Page, circleName: string): Promise<void> {
  await page.goto('/start');
  await page.getByLabel('Circle name').fill(circleName);
  await page.getByRole('button', { name: `Create ${circleName}` }).click();
  await expect(page.getByText('Your first catch-up')).toBeVisible();
  await page.getByRole('button', { name: 'Ask the group' }).click();
  await expect(page.getByText("Your plan's ready. Save your place.")).toBeVisible();
}

async function signInByCode(page: Page, email: string): Promise<void> {
  await page.getByLabel('Your email').fill(email);
  await page.getByRole('button', { name: 'Send me a code' }).click();
  await expect(page.getByText(`Sent to ${email}.`, { exact: false })).toBeVisible();
  const code = page.getByLabel('Code', { exact: true });
  // One field under the six boxes, marked so that iOS offers the code from
  // Mail above the keyboard and Android from its SMS/email autofill — the
  // reason the field is built that way (S1-22). Nothing here can tap the
  // suggestion; this pins what makes it appear.
  await expect(code).toHaveAttribute('autocomplete', 'one-time-code');
  await expect(code).toHaveAttribute('inputmode', 'numeric');
  await code.fill(await latestCodeFor(email));
  await page.getByRole('button', { name: 'Continue' }).click();
}

/**
 * What a new organiser says to "How did you hear about Wenna?" (SUS-171): a
 * chip's name, or `Skip`. It is the LAST step of the first run, after the
 * account, the circle and the plan exist, and just before the circle.
 */
async function answerSource(page: Page, answer: string): Promise<void> {
  await expect(page.getByText('How did you hear about Wenna?')).toBeVisible();
  await page
    .getByRole(answer === 'Skip' ? 'button' : 'checkbox', { name: answer, exact: true })
    .click();
}

test('a new organiser reaches a shareable plan link with two typed inputs and no permission asks', async ({
  page,
}) => {
  await watchForPermissionAsks(page);
  const requests: string[] = [];
  page.on('request', (request) => requests.push(`${request.url()} ${request.postData() ?? ''}`));

  await page.goto('/start');
  const email = `${globalThis.crypto.randomUUID()}@example.test`;

  // The first screen is the circle, with no sign-in before it (ADR 0053). The
  // two typed inputs are the circle's name and, after the gate, the organiser's.
  let typed = 0;
  await expect(page.getByLabel('Circle name')).toBeVisible();
  // Only the two drafting steps are numbered (SUS-196): this is the first.
  await expect(page.getByText('Step 1 of 2').first()).toBeVisible();
  expect(await typedFieldsOnScreen(page), 'FirstCircle has one field').toBe(1);
  await page.getByLabel('Circle name').fill('Sunday Crew');
  typed += 1;
  await page.getByRole('button', { name: 'Create Sunday Crew' }).click();

  // The plan, drafted: a circle of one, so the quorum is words and not a number.
  await expect(page.getByText('Your first catch-up')).toBeVisible();
  expect(await typedFieldsOnScreen(page), 'nothing to type on the first plan').toBe(0);
  await expect(page.getByText('Most of the group need to make it')).toBeVisible();
  await expect(page.getByText('Step 2 of 2')).toBeVisible();

  // Anything on the card can be changed with no account: the full setup, over the
  // draft. Three hours instead of two, saved on the device and sent nowhere.
  await expect(page.getByText('About 2 hours')).toBeVisible();
  await page.getByRole('button', { name: 'Change' }).first().click();
  await expect(page).toHaveURL(/\/circles\/new\/plan\/setup$/);
  await expect(page.getByRole('button', { name: 'Save plan' })).toBeVisible();
  await page.getByRole('checkbox', { name: '3 hrs' }).click();
  await page.getByRole('button', { name: 'Save plan' }).click();
  await expect(page.getByText('About 3 hours')).toBeVisible();
  // It survives a reload.
  await page.reload();
  await expect(page.getByText('About 3 hours')).toBeVisible();
  await page.getByRole('button', { name: 'Ask the group' }).click();

  // The gate is the third screen, after the plan, and nothing exists yet.
  await expect(page.getByText("Your plan's ready. Save your place.")).toBeVisible();
  expect(
    requests.filter((request) => /create-circle|create-plan/.test(request)),
    'nothing is sent to be made before the place is saved',
  ).toEqual([]);
  await signInByCode(page, email);

  // Straight after the code is Your name: the question is not the first thing.
  await expect(page).toHaveURL(/\/name$/);
  await expect(page.getByLabel('Your name')).toBeVisible();
  await expect(page.getByText('How did you hear about Wenna?')).toHaveCount(0);
  expect(await typedFieldsOnScreen(page), 'Your name has one field').toBe(1);
  await page.getByLabel('Your name').fill('Maya');
  typed += 1;
  await page.getByRole('button', { name: 'Continue' }).click();

  // The last step: the circle and the plan are made, and it is one tap.
  await expect(page.getByText('How did you hear about Wenna?')).toBeVisible();
  expect(circlesOwnedBy(profileFor(email)!.userId)).toHaveLength(1);
  expect(await typedFieldsOnScreen(page), 'the question has nothing to type').toBe(0);
  await answerSource(page, 'Reddit');

  // Straight to the share screen: the circle and the plan are made on the way.
  await expect(page.getByText('Ask Sunday Crew.')).toBeVisible();
  // The gate, the name and the finish sat between the plan and here, so this
  // screen does not claim to be a numbered step (SUS-196).
  // Earlier screens stay mounted underneath on the web stack: only what is on show counts.
  await expect(page.getByText(/^Step \d of \d$/).locator('visible=true')).toHaveCount(0);
  expect(typed).toBe(2);
  expect(await page.evaluate('window.permissionAsks'), 'no permission was asked for').toEqual([]);
  // A circle of one asks for three: the placeholder that follows the circle as
  // people tap the link (ADR 0026, unchanged).
  const draftedPlan = plansIn(circlesOwnedBy(profileFor(email)!.userId)[0]!.id)[0];
  expect(quorumOf(draftedPlan!.id)).toEqual({ quorum: 3, source: 'defaulted' });
  // And the plan made after the gate is the one that was changed before it.
  expect(durationOf(draftedPlan!.id)).toBe(180);

  // In the database: a profile named and zoned, the circle it owns, and a plan
  // whose quorum is a placeholder.
  const profile = profileFor(email);
  expect(profile?.name).toBe('Maya');
  const deviceZone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  expect(profile?.zone).toBe(deviceZone);
  const [circle] = circlesOwnedBy(profile!.userId);
  expect(circle).toMatchObject({ name: 'Sunday Crew', cadence: 'monthly' });
  const [plan] = plansIn(circle!.id);
  expect(plan?.state).toBe('collecting');

  // The link in the chat is the plan's, and it has no secret in it.
  const link = await page
    .getByText(new RegExp(`/j/${plan!.code}`))
    .first()
    .innerText();
  expect(link).toMatch(new RegExp(`^http://localhost:\\d+/j/${plan!.code}$`));

  // Copy works without a share sheet (the in-app browsers).
  await page.getByRole('button', { name: 'Copy' }).click();
  await expect(page.getByText('Copied')).toBeVisible();

  // And the first session ends with the organiser's own times in.
  await page.getByRole('button', { name: 'Add my times' }).click();
  await expect(page).toHaveURL(new RegExp(`/j/${plan!.code}$`));
  await page.getByRole('group', { name: 'Days in this plan' }).getByRole('button').first().click();
  await page.getByRole('button', { name: 'Send my times' }).click();
  await expect(page.getByText('Thanks, Maya. Your times are in.')).toBeVisible();
  // The organiser is the one who picks, and the line says so (SUS-196).
  await expect(page.getByText(/^You'll pick a time once replies close on /)).toBeVisible();
  await expect(page.getByText(/will pick a time/)).toHaveCount(0);
  // An account is already told about this plan, so the guest offer is not made.
  await expect(page.getByText("Hear when it's locked in")).toHaveCount(0);

  await page.getByRole('button', { name: "See how it's looking" }).click();
  // Exact: the share screen stays mounted underneath on the web stack, and its
  // preview card reads "Sunday Crew is finding a time to catch up".
  await expect(page.getByText('Finding a time', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('1 of 1 replied')).toBeVisible();
});

test('a returning organiser with a name skips Your name and lands on their circles', async ({
  page,
}) => {
  const maya = await accountToSignInTo('Maya');
  const circleId = circleOwnedBy(maya.userId, 'Sunday Crew');

  await page.goto('/sign-in');
  await signInByCode(page, maya.email);

  // Her circles, live since S1-23, and her circle among them by its real id.
  await expect(page).toHaveURL(/\/circles$/);
  await expect(page.getByText('Your circles')).toBeVisible();
  await page.getByRole('button', { name: /^Sunday Crew\./ }).click();
  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}$`));
  // The heading, not the text: the list stays mounted underneath on the web stack.
  await expect(page.getByRole('heading', { name: 'Sunday Crew' })).toBeVisible();
});

test('"I have an account" on a plan link signs in and comes back to the one-tap join', async ({
  page,
}) => {
  const crew = sundayCrew();
  guestWhoAnswered(crew, 'Tom');
  const ren = await accountToSignInTo('Ren');

  await page.goto(`/p/${crew.planCode}`);
  await expect(page.getByText('Have you answered this before?')).toBeVisible();
  await page.getByRole('button', { name: 'I have an account' }).click();

  await expect(page).toHaveURL(new RegExp(`/sign-in\\?next=(%2F|/)p(%2F|/)${crew.planCode}$`));
  await signInByCode(page, ren.email);

  await expect(page).toHaveURL(new RegExp(`/p/${crew.planCode}$`));
  const join = page.getByRole('button', { name: 'Join Sunday Crew as Ren' });
  await expect(join).toBeVisible();
  await join.click();

  await expect(page).toHaveURL(new RegExp(`/j/${crew.planCode}$`));
  const member = memberNamed(crew.circleId, 'Ren');
  expect(member?.userId, 'the account itself, not a new guest').toBe(ren.userId);
  expect(member?.anonymous).toBe(false);
  expect(isParticipant(crew.planId, ren.userId)).toBe(true);
});

test('a return path that leaves the site is ignored', async ({ page }) => {
  const ren = await accountToSignInTo('Ren');
  await page.goto('/sign-in?next=https%3A%2F%2Felsewhere.example%2Fj%2Fabcdefgh');
  await signInByCode(page, ren.email);
  await expect(page).toHaveURL(/^http:\/\/localhost:\d+\/circles/);
});

test('where the browser has a share sheet, "Share to group chat" hands it the plan link', async ({
  page,
}) => {
  // Mobile Safari and Chrome have `navigator.share`; the in-app browsers and
  // Playwright's own builds mostly do not, so the copy path is what the first
  // run above takes. This is the other half: the sheet, given the message.
  await page.addInitScript({
    content: `
      window.shared = [];
      navigator.share = (data) => { window.shared.push(data); return Promise.resolve(); };
      navigator.canShare = () => true;
    `,
  });
  const maya = await signedInAccount('Maya');
  const circleId = circleOwnedBy(maya.userId, 'Sunday Crew');
  const plan = planFor(circleId, maya.userId);
  await signedInAs(page, maya.stored);

  await page.goto(`/circles/${circleId}/plan/${plan.id}/shared`);
  await page.getByRole('button', { name: 'Share to group chat' }).click();

  await expect
    .poll(() => page.evaluate('window.shared.map((d) => d.text).join("\\n")'))
    .toMatch(new RegExp(`/j/${plan.code}\\b`));
  await expect(page.getByText('Copied', { exact: true })).toHaveCount(0);
});

test('"How did you hear about Wenna?" is asked once per account, counts one word, and names nobody', async ({
  page,
  browser,
}) => {
  const email = `${globalThis.crypto.randomUUID()}@example.test`;
  // This account's own events: other projects run this file at the same time.
  const sources = () =>
    sql(
      `select e.properties::text from analytics.events e join auth.users u on u.id = e.user_id
        where e.event_name = 'organiser_source' and u.email = '${email}' order by e.occurred_at`,
    ).map(([properties]) => properties);
  const before = 0;

  const firstName = `Source ${globalThis.crypto.randomUUID().slice(0, 8)}`;
  await draftThroughThePlan(page, firstName);
  await signInByCode(page, email);
  await expect(page).toHaveURL(/\/name$/);
  await expect(page.getByText('How did you hear about Wenna?')).toHaveCount(0);
  await page.getByLabel('Your name').fill('Maya');
  await page.getByRole('button', { name: 'Continue' }).click();
  // Asked last: the circle already exists, and nothing has been counted yet.
  await expect(page.getByText('How did you hear about Wenna?')).toBeVisible();
  expect(circleCountNamed(firstName)).toBe(1);
  expect(sources()).toEqual([]);
  await answerSource(page, 'A meetup or club');
  await expect(page.getByText(`Ask ${firstName}.`)).toBeVisible();

  // The event is one word and nothing else; the account's own record holds only
  // that it was answered, the same for every choice.
  await expect.poll(() => sources().length, { timeout: 20_000 }).toBe(before + 1);
  expect(sources().at(-1)).toBe('{"source": "meetup"}');
  const asked = sql(
    `select n.answer = 'tapped' from nudge_states n join auth.users u on u.id = n.user_id
      where u.email = '${email}' and n.moment = 'organiser_source'`,
  );
  expect(asked).toEqual([['t']]);

  // The same account at the gate on another device: not asked again.
  const other = await browser.newContext();
  const second = await other.newPage();
  const secondName = `Source ${globalThis.crypto.randomUUID().slice(0, 8)}`;
  await draftThroughThePlan(second, secondName);
  await second.getByLabel('Your email').fill(email);
  await second.getByRole('button', { name: 'Send me a code' }).click();
  await expect(second.getByLabel('Code', { exact: true })).toBeVisible();
  await second.getByLabel('Code', { exact: true }).fill(await latestCodeFor(email));
  await second.getByRole('button', { name: 'Continue' }).click();
  await expect(second.getByText(`Ask ${secondName}.`)).toBeVisible();
  await expect(second.getByText('How did you hear about Wenna?')).toHaveCount(0);
  expect(sources().length).toBe(before + 1);
  await other.close();
});

test('arriving on a tagged link skips "How did you hear", counts content, and tags the circle (SUS-240)', async ({
  page,
}) => {
  const tag = `tt-e2e-${globalThis.crypto.randomUUID().slice(0, 8)}`;
  const name = `Tagged ${globalThis.crypto.randomUUID().slice(0, 8)}`;
  const email = `${globalThis.crypto.randomUUID()}@example.test`;
  // Where the tag goes after the arrival: the page's own requests only.
  const sent: string[] = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'fetch' || request.resourceType() === 'xhr') {
      sent.push(`${request.url()} ${request.postData() ?? ''}`);
    }
  });

  // What the site's "Start a plan" hands the app.
  await page.goto(`/start?via=site&from=${tag}`);
  await page.getByLabel('Circle name').fill(name);
  await page.getByRole('button', { name: `Create ${name}` }).click();
  await expect(page.getByText('Your first catch-up')).toBeVisible();
  await page.getByRole('button', { name: 'Ask the group' }).click();
  await expect(page.getByText("Your plan's ready. Save your place.")).toBeVisible();
  // Reached through the draft, a reload and the round trip to the code: the tag is kept.
  await page.reload();
  await expect(page.getByText("Your plan's ready. Save your place.")).toBeVisible();

  await signInByCode(page, email);
  await expect(page).toHaveURL(/\/name$/);
  await expect(page.getByText('How did you hear about Wenna?')).toHaveCount(0);
  await page.getByLabel('Your name').fill('Maya');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText(`Ask ${name}.`)).toBeVisible();
  await expect(page.getByText('How did you hear about Wenna?')).toHaveCount(0);

  // Counted as `content` and as asked; the account is not asked again.
  const sources = sql(
    `select e.properties::text from analytics.events e join auth.users u on u.id = e.user_id
      where e.event_name = 'organiser_source' and u.email = '${email}'`,
  );
  expect(sources).toEqual([['{"source": "content"}']]);
  expect(
    sql(
      `select n.answer from nudge_states n join auth.users u on u.id = n.user_id
        where u.email = '${email}' and n.moment = 'organiser_source'`,
    ),
  ).toEqual([['tapped']]);

  // On the circle's founder-only cohort row, and nowhere a client can read.
  expect(
    sql(
      `select cc.source_ref from private.circle_cohorts cc join circles c on c.id = cc.circle_id
        where c.name = '${name}'`,
    ),
  ).toEqual([[tag]]);
  // The only request that carried it is the one that makes the circle.
  expect(
    sent.filter((request) => request.includes(tag)).every((r) => /create-circle/.test(r)),
  ).toBe(true);
  expect(sent.some((request) => /create-circle/.test(request) && request.includes(tag))).toBe(true);
  expect(sent.filter((request) => /track-events/.test(request) && request.includes(tag))).toEqual(
    [],
  );
  // And it is not left on the device once the circle is made.
  expect(await page.evaluate(() => globalThis.localStorage.getItem('circles.arrival-tag'))).toBe(
    null,
  );
});

test('a malformed tag is dropped and the question is asked as today (SUS-240)', async ({
  page,
}) => {
  const email = `${globalThis.crypto.randomUUID()}@example.test`;
  await page.goto('/start?via=site&from=Not%20A%20Slug');
  expect(await page.evaluate(() => globalThis.localStorage.getItem('circles.arrival-tag'))).toBe(
    null,
  );
  await page
    .getByLabel('Circle name')
    .fill(`Untagged ${globalThis.crypto.randomUUID().slice(0, 8)}`);
  await page.getByRole('button', { name: /^Create / }).click();
  await page.getByRole('button', { name: 'Ask the group' }).click();
  await signInByCode(page, email);
  await expect(page).toHaveURL(/\/name$/);
  await page.getByLabel('Your name').fill('Maya');
  await page.getByRole('button', { name: 'Continue' }).click();
  await answerSource(page, 'Skip');
});

test('walking away at the last question leaves the source unanswered, with the circle made (SUS-171)', async ({
  page,
}) => {
  const name = `Walked ${globalThis.crypto.randomUUID().slice(0, 8)}`;
  const email = `${globalThis.crypto.randomUUID()}@example.test`;
  await draftThroughThePlan(page, name);
  await signInByCode(page, email);
  await page.getByLabel('Your name').fill('Maya');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('How did you hear about Wenna?')).toBeVisible();
  expect(circleCountNamed(name)).toBe(1);

  // Gone without answering: no source, no error, and the circle is on their list.
  await page.goto('/circles');
  await expect(page.getByRole('button', { name: new RegExp(`^${name}\\.`) })).toBeVisible();
  expect(
    sql(
      `select count(*) from analytics.events e join auth.users u on u.id = e.user_id
        where e.event_name = 'organiser_source' and u.email = '${email}'`,
    ),
  ).toEqual([['0']]);
  // And no draft is left behind to make a second circle from.
  await page.goto('/circles/new');
  await expect(page.getByLabel('Circle name')).toHaveValue('');
});

test('abandoning at the gate creates nothing, and a reload keeps the draft', async ({ page }) => {
  const name = `Abandon ${globalThis.crypto.randomUUID().slice(0, 8)}`;
  await draftThroughThePlan(page, name);

  // A reload on the gate: the draft is still there, and so is the screen.
  await page.reload();
  await expect(page.getByText("Your plan's ready. Save your place.")).toBeVisible();
  // Back at the front door the name is still typed.
  await page.goto('/start');
  await expect(page.getByLabel('Circle name')).toHaveValue(name);

  expect(circleCountNamed(name), 'no circle after walking away').toBe(0);
});

test('a draft older than 24 hours is gone', async ({ page }) => {
  await draftThroughThePlan(page, 'Stale Crew');
  await page.evaluate(() => {
    const key = 'circles.organiser-draft';
    const draft = JSON.parse(globalThis.localStorage.getItem(key) ?? '{}');
    draft.updatedAt = Date.now() - 24 * 60 * 60 * 1000 - 1000;
    globalThis.localStorage.setItem(key, JSON.stringify(draft));
  });

  await page.goto('/start');
  await expect(page.getByLabel('Circle name')).toHaveValue('');
  expect(
    await page.evaluate(() => globalThis.localStorage.getItem('circles.organiser-draft')),
  ).toBe(null);
});

test('the draft survives the email code, and the circle is made only after it', async ({
  page,
}) => {
  const name = `Coded ${globalThis.crypto.randomUUID().slice(0, 8)}`;
  const email = `${globalThis.crypto.randomUUID()}@example.test`;
  await draftThroughThePlan(page, name);

  await page.getByLabel('Your email').fill(email);
  await page.getByRole('button', { name: 'Send me a code' }).click();
  await expect(page.getByLabel('Code', { exact: true })).toBeVisible();
  expect(circleCountNamed(name), 'a code was asked for, still nothing made').toBe(0);

  // Reload in the middle of the round trip: the gate asks again, the draft holds.
  // A second address, because the auth server holds a second code for the first
  // back for a minute.
  await page.reload();
  await expect(page.getByText("Your plan's ready. Save your place.")).toBeVisible();
  const second = `${globalThis.crypto.randomUUID()}@example.test`;
  await signInByCode(page, second);
  await page.getByLabel('Your name').fill('Maya');
  await page.getByRole('button', { name: 'Continue' }).click();
  await answerSource(page, 'Skip');

  await expect(page.getByText(`Ask ${name}.`)).toBeVisible();
  expect(circleCountNamed(name)).toBe(1);
});

test('a signed-in organiser goes circle, plan, share with no gate', async ({ page }) => {
  const maya = await accountToSignInTo('Maya');
  await page.goto('/sign-in');
  await signInByCode(page, maya.email);
  await expect(page).toHaveURL(/\/circles(\/new)?$/);

  const name = `Again ${globalThis.crypto.randomUUID().slice(0, 8)}`;
  await page.goto('/circles/new');
  await page.getByLabel('Circle name').fill(name);
  await page.getByRole('button', { name: `Create ${name}` }).click();
  await page.getByRole('button', { name: 'Ask the group' }).click();

  await expect(page.getByText(`Ask ${name}.`)).toBeVisible();
  await expect(page.getByText('Save your place')).toHaveCount(0);
  expect(circleCountNamed(name)).toBe(1);
});

test('on a desktop window the "Setting up" wait sits in the same centred column as the screens around it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await draftThroughThePlan(page, 'Sunday Crew');
  // Hold the circle's creation so the wait stays on screen long enough to measure.
  await page.route('**/functions/v1/create-circle', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 6000));
    await route.continue();
  });
  const email = `${globalThis.crypto.randomUUID()}@example.test`;
  await signInByCode(page, email);
  await page.getByLabel('Your name').fill('Maya');
  await page.getByRole('button', { name: 'Continue' }).click();

  const waiting = page.getByText('Setting up Sunday Crew');
  await expect(waiting).toBeVisible();
  const box = (await waiting.boundingBox())!;
  // The column is 480 wide and centred in 1280, so its text starts 400 + 22 in
  // and never runs past 400 + 480 (manifesto 5.3).
  expect(box.x).toBeCloseTo(422, 0);
  expect(box.x + box.width).toBeLessThanOrEqual(880);
  const sideways = await page.evaluate(
    'document.documentElement.scrollWidth - document.documentElement.clientWidth',
  );
  expect(sideways).toBeLessThanOrEqual(0);

  await expect(page.getByText('How did you hear about Wenna?')).toBeVisible({ timeout: 20_000 });
  await answerSource(page, 'Skip');
  await expect(page.getByText('Ask Sunday Crew.')).toBeVisible();
});
