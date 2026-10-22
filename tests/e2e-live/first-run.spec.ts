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
 * The first run (S1-22, SUS-150, SUS-247; spec §5.1, §6.1, ADR 0090): who it is
 * for → which evenings → who's asking → the code → the share, then circle home.
 * Four typed inputs: the group's name, a first name, an email and the code.
 * Nothing is created until the code is accepted (ADR 0053), and the organiser's
 * own evenings are in the plan when it is shared. Then the ways a returning organiser comes in, and
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

/** The days of the evenings grid, as a person would tap them. */
function evenings(page: Page) {
  return page.getByRole('button', { name: /, evening$/ });
}

/** Screens 1 and 2: the group's name, then one evening a few days on. Ends at "Who's asking?". */
async function draftThroughTheEvenings(page: Page, groupName: string): Promise<void> {
  await page.goto('/start');
  await page.getByLabel('Who do you keep meaning to see?').fill(groupName);
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('Which evenings could you do?')).toBeVisible();
  await evenings(page).nth(6).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText("Who's asking?")).toBeVisible();
}

/** Screen 3: a first name and an email, then the code is asked for. */
async function askForTheCode(page: Page, firstName: string, email: string): Promise<void> {
  await page.getByLabel('First name').fill(firstName);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await expect(page.getByText(`Sent to ${email}.`, { exact: false })).toBeVisible();
}

/** Screen 4: the six digits from the mail catcher. The sixth sends them; there is no Continue. */
async function typeTheCode(page: Page, email: string): Promise<void> {
  const code = page.getByLabel('Code', { exact: true });
  // One field under the six boxes, marked so that iOS offers the code from
  // Mail above the keyboard and Android from its SMS/email autofill — the
  // reason the field is built that way (S1-22). Nothing here can tap the
  // suggestion; this pins what makes it appear.
  await expect(code).toHaveAttribute('autocomplete', 'one-time-code');
  await expect(code).toHaveAttribute('inputmode', 'numeric');
  await expect(page.getByRole('button', { name: 'Continue' })).toHaveCount(0);
  await code.fill(await latestCodeFor(email));
}

/** The ordinary sign-in: an email, then the code. */
async function signInByCode(page: Page, email: string): Promise<void> {
  await page.getByLabel('Your email').fill(email);
  await page.getByRole('button', { name: 'Send me a code' }).click();
  await expect(page.getByText(`Sent to ${email}.`, { exact: false })).toBeVisible();
  await typeTheCode(page, email);
}

/** The share's done state: the share sheet closed, here by the copy path of a browser without one. */
async function shareTheLink(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Share to group chat' }).click();
  await expect(page.getByText(/^Over to /)).toBeVisible();
}

/**
 * What a new organiser says to "How did you hear about Wenna?" (SUS-171): a
 * chip's name, or `Skip`. It is a quiet card after the share (ADR 0090).
 */
async function answerSource(page: Page, answer: string): Promise<void> {
  await expect(page.getByText('How did you hear about Wenna?')).toBeVisible();
  await page
    .getByRole(answer === 'Skip' ? 'button' : 'checkbox', { name: answer, exact: true })
    .click();
}

/** The organiser's own response to a plan, in the database. */
function ownTimesIn(planId: string, userId: string): number {
  return Number(
    sql(
      `select count(*) from public.plan_responses where plan_id = '${planId}' and user_id = '${userId}'`,
    )[0]?.[0] ?? 0,
  );
}

test('a new organiser reaches the share on the fifth screen, with four typed inputs, their evenings in the plan and no permission asks', async ({
  page,
}) => {
  await watchForPermissionAsks(page);
  const requests: string[] = [];
  page.on('request', (request) => requests.push(`${request.url()} ${request.postData() ?? ''}`));

  await page.goto('/start');
  const email = `${globalThis.crypto.randomUUID()}@example.test`;
  // Another suite's circle may be called Sunday Crew; this one is its own.
  const group = `Sunday Crew ${globalThis.crypto.randomUUID().slice(0, 6)}`;
  let typed = 0;

  // Screen 1: one field, whose label is the heading, and the message filling in.
  await expect(page.getByLabel('Who do you keep meaning to see?')).toBeVisible();
  await expect(page.getByText('1 of 3')).toBeVisible();
  expect(await typedFieldsOnScreen(page), 'screen 1 has one field').toBe(1);
  await page.getByLabel('Who do you keep meaning to see?').fill(group);
  typed += 1;
  await expect(page.getByText(`To ${group}`)).toBeVisible();
  await expect(page.getByText('No app, no account.')).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();

  // Screen 2: the evenings. Nothing to type; Next waits for a day.
  await expect(page.getByText('Which evenings could you do?')).toBeVisible();
  await expect(page.getByText('2 of 3')).toBeVisible();
  expect(await typedFieldsOnScreen(page), 'nothing to type on the evenings').toBe(0);
  await expect(page.getByRole('checkbox', { name: 'Monthly' })).toBeChecked();
  await expect(evenings(page)).toHaveCount(28);
  await expect(
    page.getByText(/^Evenings · about 2 hours · replies close \w{3} 6 pm$/),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click({ force: true });
  await expect(page.getByText('Pick at least one evening first.')).toBeVisible();

  // The full setup is behind Adjust, saved on the device and sent nowhere.
  // Three hours instead of two, and it survives a reload with the evenings.
  await evenings(page).nth(6).click();
  await evenings(page).nth(8).click();
  await page.getByRole('button', { name: 'Adjust' }).click();
  await page.getByRole('checkbox', { name: 'About 3 hours' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.reload();
  await expect(page.getByText(/about 3 hours/)).toBeVisible();
  await expect(evenings(page).nth(6)).toHaveAttribute('aria-pressed', 'true');
  await expect(evenings(page).nth(8)).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Next' }).click();

  // Screen 3: a first name and an email, nothing else, and nothing exists yet.
  await expect(page.getByText("Who's asking?")).toBeVisible();
  await expect(page.getByText('3 of 3')).toBeVisible();
  expect(await typedFieldsOnScreen(page), 'screen 3 has two fields').toBe(2);
  await askForTheCode(page, 'Maya', email);
  typed += 2;
  expect(
    requests.filter((request) => /create-circle|create-plan|submit-availability/.test(request)),
    'nothing is sent to be made before the code is accepted',
  ).toEqual([]);
  expect(circleCountNamed(group)).toBe(0);

  // Screen 4: the code sends itself; the circle, the plan and the answer are made inside it.
  await expect(page.getByText('Enter the code we emailed')).toBeVisible();
  await typeTheCode(page, email);
  typed += 1;
  await expect(page.getByText(`Ask ${group}.`)).toBeVisible();
  // Straight from the code to the share: Your name was not asked, nor the source.
  await expect(page.getByText('What should friends call you?')).toHaveCount(0);
  await expect(page.getByText('How did you hear about Wenna?')).toHaveCount(0);
  // The share is not a numbered step.
  await expect(page.getByText(/^\d of \d$/).locator('visible=true')).toHaveCount(0);
  expect(typed).toBe(4);
  expect(await page.evaluate('window.permissionAsks'), 'no permission was asked for').toEqual([]);

  // In the database: a profile named and zoned, the circle it owns, a plan whose
  // quorum is a placeholder and whose length is the one chosen, and the
  // organiser's own answer to it.
  const profile = profileFor(email);
  expect(profile?.name).toBe('Maya');
  const deviceZone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  expect(profile?.zone).toBe(deviceZone);
  const [circle] = circlesOwnedBy(profile!.userId);
  expect(circle).toMatchObject({ name: group, cadence: 'monthly' });
  const [plan] = plansIn(circle!.id);
  expect(plan?.state).toBe('collecting');
  expect(quorumOf(plan!.id)).toEqual({ quorum: 3, source: 'defaulted' });
  expect(durationOf(plan!.id)).toBe(180);
  expect(ownTimesIn(plan!.id, profile!.userId)).toBe(1);
  // Four weeks, and the deadline lands at 6 pm on the plan's clock.
  expect(
    sql(`select window_end - window_start from public.plans where id = '${plan!.id}'`)[0]?.[0],
  ).toBe('27');
  expect(
    sql(
      `select extract(hour from response_deadline at time zone '${deviceZone}') from public.plans where id = '${plan!.id}'`,
    )[0]?.[0],
  ).toBe('18');

  // The link in the chat is the plan's, and it has no secret in it.
  await expect(page.getByText(new RegExp(`/j/${plan!.code}`)).first()).toBeVisible();
  expect(
    await page
      .getByText(new RegExp(`/j/${plan!.code}`))
      .first()
      .innerText(),
  ).toContain(`/j/${plan!.code}`);

  // Copy works without a share sheet (the in-app browsers).
  await page.getByRole('button', { name: 'Copy' }).click();
  await expect(page.getByText('Copied')).toBeVisible();

  // The answer is in, so there is no Add my times; the share turns into "Over to".
  await expect(page.getByRole('button', { name: 'Add my times' })).toHaveCount(0);
  await shareTheLink(page);
  await expect(page.getByText("We'll email you when the best times are in.")).toBeVisible();
  await answerSource(page, 'Skip');

  await page.getByRole('button', { name: `Go to ${group}` }).click();
  await expect(page).toHaveURL(new RegExp(`/circles/${circle!.id}$`));
  await expect(page.getByText('Finding a time', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('1 of 1 replied')).toBeVisible();
});

test('an organiser who adds their own times later reaches the share with Add my times', async ({
  page,
}) => {
  const name = `Later ${globalThis.crypto.randomUUID().slice(0, 8)}`;
  const email = `${globalThis.crypto.randomUUID()}@example.test`;
  await page.goto('/start');
  await page.getByLabel('Who do you keep meaning to see?').fill(name);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: "I'll add mine later" }).click();
  await expect(page.getByText("Who's asking?")).toBeVisible();
  await askForTheCode(page, 'Maya', email);
  await typeTheCode(page, email);

  await expect(page.getByText(`Ask ${name}.`)).toBeVisible();
  const [circle] = circlesOwnedBy(profileFor(email)!.userId);
  const [plan] = plansIn(circle!.id);
  expect(ownTimesIn(plan!.id, profileFor(email)!.userId)).toBe(0);

  await page.getByRole('button', { name: 'Add my times' }).click();
  await expect(page).toHaveURL(new RegExp(`/j/${plan!.code}$`));
});

test('a wrong code clears the boxes and keeps what was chosen', async ({ page }) => {
  const name = `Wrong ${globalThis.crypto.randomUUID().slice(0, 8)}`;
  const email = `${globalThis.crypto.randomUUID()}@example.test`;
  await draftThroughTheEvenings(page, name);
  await askForTheCode(page, 'Maya', email);

  const code = page.getByLabel('Code', { exact: true });
  await code.fill('000000');
  await expect(page.getByText(/^That code didn't work/)).toBeVisible();
  await expect(code).toHaveValue('');
  await expect(code).toBeFocused();
  expect(circleCountNamed(name)).toBe(0);

  // The right one still works, and the draft was kept.
  await typeTheCode(page, email);
  await expect(page.getByText(`Ask ${name}.`)).toBeVisible();
  expect(circleCountNamed(name)).toBe(1);
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

test('"I have an account" on a plan link signs in and comes back to the list, where "I\'m new here" is one tap', async ({
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
  // Signed in now, and shown the same guests (ADR 0088); Ren is new here.
  await expect(page.getByRole('button', { name: 'Continue as Tom' })).toBeVisible();
  await page.getByRole('button', { name: "I'm new here" }).click();
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

test('"How did you hear about Wenna?" is asked once per account, after the share, counts one word, and names nobody', async ({
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

  const firstName = `Source ${globalThis.crypto.randomUUID().slice(0, 8)}`;
  await draftThroughTheEvenings(page, firstName);
  await askForTheCode(page, 'Maya', email);
  await typeTheCode(page, email);
  // The link comes first: the circle exists, and nothing has been asked or counted.
  await expect(page.getByText(`Ask ${firstName}.`)).toBeVisible();
  await expect(page.getByText('How did you hear about Wenna?')).toHaveCount(0);
  expect(circleCountNamed(firstName)).toBe(1);
  expect(sources()).toEqual([]);

  await shareTheLink(page);
  expect(await typedFieldsOnScreen(page), 'the question has nothing to type').toBe(0);
  await answerSource(page, 'A meetup or club');

  // The event is one word and nothing else; the account's own record holds only
  // that it was answered, the same for every choice.
  await expect.poll(() => sources().length, { timeout: 20_000 }).toBe(1);
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
  await draftThroughTheEvenings(second, secondName);
  await askForTheCode(second, 'Maya', email);
  await typeTheCode(second, email);
  await expect(second.getByText(`Ask ${secondName}.`)).toBeVisible();
  await shareTheLink(second);
  await expect(second.getByText('How did you hear about Wenna?')).toHaveCount(0);
  expect(sources().length).toBe(1);
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
  await page.getByLabel('Who do you keep meaning to see?').fill(name);
  await page.getByRole('button', { name: 'Next' }).click();
  await evenings(page).nth(6).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText("Who's asking?")).toBeVisible();
  // Reached through the draft and a reload: the tag is kept.
  await page.reload();
  await expect(page.getByText("Who's asking?")).toBeVisible();

  await askForTheCode(page, 'Maya', email);
  await typeTheCode(page, email);
  await expect(page.getByText(`Ask ${name}.`)).toBeVisible();
  await shareTheLink(page);
  await expect(page.getByText('How did you hear about Wenna?')).toHaveCount(0);

  // Counted as `content` and as asked; the account is not asked again.
  await expect
    .poll(
      () =>
        sql(
          `select e.properties::text from analytics.events e join auth.users u on u.id = e.user_id
            where e.event_name = 'organiser_source' and u.email = '${email}'`,
        ),
      { timeout: 20_000 },
    )
    .toEqual([['{"source": "content"}']]);
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

test('a malformed tag is dropped and the question is asked as for anyone (SUS-240)', async ({
  page,
}) => {
  const email = `${globalThis.crypto.randomUUID()}@example.test`;
  await page.goto('/start?via=site&from=Not%20A%20Slug');
  expect(await page.evaluate(() => globalThis.localStorage.getItem('circles.arrival-tag'))).toBe(
    null,
  );
  await draftThroughTheEvenings(page, `Untagged ${globalThis.crypto.randomUUID().slice(0, 8)}`);
  await askForTheCode(page, 'Maya', email);
  await typeTheCode(page, email);
  await expect(page.getByText(/^Ask Untagged /)).toBeVisible();
  await shareTheLink(page);
  await answerSource(page, 'Skip');
});

test('walking away at the question leaves the source unanswered, with the circle made (SUS-171)', async ({
  page,
}) => {
  const name = `Walked ${globalThis.crypto.randomUUID().slice(0, 8)}`;
  const email = `${globalThis.crypto.randomUUID()}@example.test`;
  await draftThroughTheEvenings(page, name);
  await askForTheCode(page, 'Maya', email);
  await typeTheCode(page, email);
  await shareTheLink(page);
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
  await expect(page.getByLabel('Who do you keep meaning to see?')).toHaveValue('');
});

test('abandoning at the gate creates nothing, and a reload keeps the draft', async ({ page }) => {
  const name = `Abandon ${globalThis.crypto.randomUUID().slice(0, 8)}`;
  await draftThroughTheEvenings(page, name);

  // A reload on the gate: the draft is still there, and so is the screen.
  await page.reload();
  await expect(page.getByText("Who's asking?")).toBeVisible();
  // Back at the front door the name is still typed.
  await page.goto('/start');
  await expect(page.getByLabel('Who do you keep meaning to see?')).toHaveValue(name);

  expect(circleCountNamed(name), 'no circle after walking away').toBe(0);
});

test('a draft older than 24 hours is gone', async ({ page }) => {
  await draftThroughTheEvenings(page, 'Stale Crew');
  await page.evaluate(() => {
    const key = 'circles.organiser-draft';
    const draft = JSON.parse(globalThis.localStorage.getItem(key) ?? '{}');
    draft.updatedAt = Date.now() - 24 * 60 * 60 * 1000 - 1000;
    globalThis.localStorage.setItem(key, JSON.stringify(draft));
  });

  await page.goto('/start');
  await expect(page.getByLabel('Who do you keep meaning to see?')).toHaveValue('');
  expect(
    await page.evaluate(() => globalThis.localStorage.getItem('circles.organiser-draft')),
  ).toBe(null);
});

test('a version 2 draft still in the browser reads as a draft with no answer', async ({ page }) => {
  await page.goto('/start');
  const name = `Old ${globalThis.crypto.randomUUID().slice(0, 8)}`;
  await page.evaluate((groupName) => {
    globalThis.localStorage.setItem(
      'circles.organiser-draft',
      JSON.stringify({
        v: 2,
        updatedAt: Date.now(),
        circleName: groupName,
        cadence: 'weekly',
        plan: { category: 'catch_up', preset: 'next_14_days', duration: 120 },
        way: 'ask',
        proceed: false,
        circleCounted: false,
        keys: { circle: crypto.randomUUID(), plan: crypto.randomUUID() },
      }),
    );
  }, name);

  await page.goto('/start');
  await expect(page.getByLabel('Who do you keep meaning to see?')).toHaveValue(name);
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('Which evenings could you do?')).toBeVisible();
  // Its own window, and nothing picked: Next waits.
  await expect(page.getByRole('checkbox', { name: 'Next 2 weeks' })).toBeChecked();
  await expect(evenings(page).first()).toHaveAttribute('aria-pressed', 'false');
});

test('the draft survives the email code, and the circle is made only after it', async ({
  page,
}) => {
  const name = `Coded ${globalThis.crypto.randomUUID().slice(0, 8)}`;
  const email = `${globalThis.crypto.randomUUID()}@example.test`;
  await draftThroughTheEvenings(page, name);

  await askForTheCode(page, 'Maya', email);
  expect(circleCountNamed(name), 'a code was asked for, still nothing made').toBe(0);

  // Reload in the middle of the round trip: the gate asks again, the draft holds.
  // A second address, because the auth server holds a second code for the first
  // back for a minute.
  await page.reload();
  await expect(page.getByText("Who's asking?")).toBeVisible();
  const second = `${globalThis.crypto.randomUUID()}@example.test`;
  await askForTheCode(page, 'Maya', second);
  await typeTheCode(page, second);

  await expect(page.getByText(`Ask ${name}.`)).toBeVisible();
  expect(circleCountNamed(name)).toBe(1);
});

test('a signed-in organiser goes group, evenings, share: three screens, no gate', async ({
  page,
}) => {
  const maya = await accountToSignInTo('Maya');
  await page.goto('/sign-in');
  await signInByCode(page, maya.email);
  await expect(page).toHaveURL(/\/circles(\/new)?$/);

  const name = `Again ${globalThis.crypto.randomUUID().slice(0, 8)}`;
  await page.goto('/circles/new');
  await expect(page.getByText('1 of 2')).toBeVisible();
  await page.getByLabel('Who do you keep meaning to see?').fill(name);
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('2 of 2')).toBeVisible();
  await evenings(page).nth(6).click();
  await page.getByRole('button', { name: 'Make the link' }).click();

  await expect(page.getByText(`Ask ${name}.`)).toBeVisible();
  await expect(page.getByText("Who's asking?")).toHaveCount(0);
  expect(circleCountNamed(name)).toBe(1);
  const [circle] = circlesOwnedBy(maya.userId).filter((each) => each.name === name);
  expect(ownTimesIn(plansIn(circle!.id)[0]!.id, maya.userId)).toBe(1);
});

test('on a desktop window the "Setting up" wait sits in the same centred column as the screens around it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await draftThroughTheEvenings(page, 'Sunday Crew');
  // Hold the circle's creation so the wait stays on screen long enough to measure.
  await page.route('**/functions/v1/create-circle', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 6000));
    await route.continue();
  });
  const email = `${globalThis.crypto.randomUUID()}@example.test`;
  await askForTheCode(page, 'Maya', email);
  await typeTheCode(page, email);

  const waiting = page.getByText('Setting up Sunday Crew');
  await expect(waiting).toBeVisible();
  const box = (await waiting.boundingBox())!;
  // The column is 480 wide and centred in 1280, so its text starts 400 + 22 in
  // and never runs past 400 + 480 (manifesto 5.3).
  expect(box.x).toBeGreaterThanOrEqual(400);
  expect(box.x + box.width).toBeLessThanOrEqual(880);
  const sideways = await page.evaluate(
    'document.documentElement.scrollWidth - document.documentElement.clientWidth',
  );
  const offenders = await page.evaluate(() =>
    [...document.querySelectorAll('*')]
      .filter((el) => el.getBoundingClientRect().right > document.documentElement.clientWidth)
      .map((el) => el.tagName + '.' + String(el.className).slice(0, 60)),
  );
  expect(sideways, offenders.join(' | ')).toBeLessThanOrEqual(0);

  await expect(page.getByText('Ask Sunday Crew.')).toBeVisible({ timeout: 20_000 });
});
