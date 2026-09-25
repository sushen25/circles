import { randomUUID } from 'node:crypto';

import { expect, test, type Browser, type Page } from './fixtures';
import { signedInAs } from './journeys';
import { circleOwnedBy, signedInAccount, sql } from './stack';

/**
 * The quiet ask end to end (S2-03, spec §5.4): three members, Maya asks
 * quietly, Tom and Jess are keen, it opens, and **Tom** — not the person who
 * asked — picks the time. And an ask that runs out shows its neutral screen to
 * Maya alone.
 *
 * The acceptance criterion this file exists for is the negative one: **no
 * response any of their browsers receive about the ask, and no analytics row,
 * connects Maya to it.** Every response from the quiet functions and every
 * read of `plans` is kept and searched for her id and for any key that would
 * name an initiator or an answer.
 */

type Person = { userId: string; name: string; page: Page; seen: string[] };

/** The responses that are *about the ask*: where an initiator or an answer could leak. */
const ABOUT_THE_ASK =
  /\/(functions\/v1\/(quiet-view|create-plan|answer-interest|accept-organiser|cancel-plan)|rest\/v1\/plans)\b/;

async function person(name: string): Promise<Omit<Person, 'page' | 'seen'> & { stored: string }> {
  const { userId, stored } = await signedInAccount(name);
  return { userId, name, stored };
}

async function open(
  browser: Browser,
  who: { userId: string; name: string; stored: string },
): Promise<Person> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signedInAs(page, who.stored);
  const seen: string[] = [];
  page.on('response', (response) => {
    if (!ABOUT_THE_ASK.test(new URL(response.url()).pathname)) return;
    void response
      .text()
      .then((body) => seen.push(body))
      .catch(() => undefined);
  });
  return { userId: who.userId, name: who.name, page, seen };
}

/** A circle of three saved places: Maya owns it, Tom and Jess are in it. */
async function threeOfUs(browser: Browser) {
  const [maya, tom, jess] = await Promise.all(['Maya', 'Tom', 'Jess'].map((name) => person(name)));
  const circleId = circleOwnedBy(maya!.userId, `Quiet ${randomUUID().slice(0, 6)}`);
  sql(`
    insert into public.circle_members (circle_id, user_id, display_name_snapshot)
    values ('${circleId}', '${tom!.userId}', 'Tom'), ('${circleId}', '${jess!.userId}', 'Jess');
  `);
  return {
    circleId,
    maya: await open(browser, maya!),
    tom: await open(browser, tom!),
    jess: await open(browser, jess!),
  };
}

/** Maya asks quietly about the next seven days, from ChooseMode. Returns the plan id. */
async function mayaAsks(maya: Person, circleId: string): Promise<string> {
  await maya.page.goto(`/circles/${circleId}/plan/mode`);
  await maya.page.getByRole('button', { name: /^See if people are keen\./ }).click();
  await expect(maya.page.getByText(/^Nobody sees who asked\. If 3 people are keen/)).toBeVisible();
  await maya.page.getByRole('checkbox', { name: 'Next 7 days' }).click();
  await expect(maya.page.getByRole('checkbox', { name: 'In two days' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await maya.page.getByRole('button', { name: 'Ask quietly' }).click();
  await expect(maya.page).toHaveURL(new RegExp(`/circles/${circleId}/quiet/[0-9a-f-]{36}$`));
  await expect(
    maya.page.getByText("We're checking who's keen for a catch-up in the next 7 days."),
  ).toBeVisible();
  // The threshold, from the view. No count, not even for her.
  await expect(maya.page.getByText('3 people are keen', { exact: true })).toBeVisible();
  return maya.page.url().split('/').at(-1)!;
}

/** From circle home's card, which is the same for everybody. */
async function answersKeen(
  member: Person,
  circleId: string,
  { opensIt = false }: { opensIt?: boolean } = {},
): Promise<void> {
  await member.page.goto(`/circles/${circleId}`);
  await expect(member.page.getByText('Asked quietly')).toBeVisible();
  await member.page.getByRole('button', { name: 'Take a look' }).click();
  await expect(
    member.page.getByText(
      /^Someone in Quiet \w+ would be up for a catch-up in the next 7 days\. Would you\?$/,
    ),
  ).toBeVisible();
  await member.page.getByRole('button', { name: "I'm keen" }).click();
  // The view read again after the answer: the answer that opened it is met by
  // the opened ask, and any other by the same thanks whatever was said.
  await expect(
    opensIt
      ? member.page.getByText('3 people are keen to catch up in the next 7 days.')
      : member.page.getByText("Thanks. We'll let you know if it opens up."),
  ).toBeVisible();
}

function expectNothingConnects(maya: Person, ...everyone: Person[]): void {
  for (const who of everyone) {
    const said = who.seen.join('\n');
    expect(said.length, `${who.name} read the ask`).toBeGreaterThan(0);
    expect(said, `nothing ${who.name} received names Maya as the one who asked`).not.toContain(
      maya.userId,
    );
    expect(said, `no key about who asked or who answered what`).not.toMatch(
      /initiator|"interested"|"my_answer"|"keen_by"|"answer"\s*:/,
    );
  }
}

test('three members: Maya asks quietly, it opens, and Tom picks the time', async ({ browser }) => {
  const { circleId, maya, tom, jess } = await threeOfUs(browser);
  const planId = await mayaAsks(maya, circleId);

  // The card on circle home says nothing about whose it is: Maya's reads the
  // same as Tom's.
  await maya.page.goto(`/circles/${circleId}`);
  const mayasCard = await maya.page.getByText('Asked quietly').locator('xpath=../..').innerText();

  await answersKeen(tom, circleId);
  const tomsCard = await tom.page
    .goto(`/circles/${circleId}`)
    .then(() => tom.page.getByText('Asked quietly').locator('xpath=../..').innerText());
  expect(tomsCard).toBe(mayasCard);

  await answersKeen(jess, circleId, { opensIt: true });
  expect(sql(`select state from public.plans where id = '${planId}'`)[0]?.[0]).toBe('collecting');

  // Tom, who did not ask, takes it on from the quiet screen.
  await tom.page.goto(`/circles/${circleId}/quiet/${planId}`);
  await expect(
    tom.page.getByText('3 people are keen to catch up in the next 7 days.'),
  ).toBeVisible();
  await expect(tom.page.getByText("3 said they're keen. We don't show who.")).toBeVisible();
  await expect(tom.page.getByText(/so far/)).toHaveCount(0);
  await tom.page.getByRole('button', { name: "I'll pick the time" }).click();
  await expect(tom.page).toHaveURL(new RegExp(`/circles/${circleId}/plan/${planId}/shared$`));
  expect(sql(`select organiser_user_id from public.plans where id = '${planId}'`)[0]?.[0]).toBe(
    tom.userId,
  );

  // Maya, who asked, is told who is picking — and nothing about having asked.
  await maya.page.goto(`/circles/${circleId}/quiet/${planId}`);
  await expect(maya.page.getByText(/^Tom volunteered to pick the time\./)).toBeVisible();
  await expect(maya.page.getByRole('button', { name: 'Choose my times' })).toBeVisible();

  expectNothingConnects(maya, maya, tom, jess);

  // Starting the ask and answering it are recorded against nobody.
  await expect
    .poll(
      () =>
        sql(`select count(*) from analytics.events where plan_id = '${planId}'
           and event_name in ('quiet_ask_created', 'quiet_interest_answered')`)[0]?.[0],
    )
    .toBe('3');
  expect(
    sql(`select count(*) from analytics.events where plan_id = '${planId}'
         and event_name in ('quiet_ask_created', 'quiet_interest_answered')
         and (user_id is not null or anonymous_id is not null)`)[0]?.[0],
  ).toBe('0');
  // Taking the role is public, and says nothing about how.
  expect(
    sql(`select user_id, properties::text from analytics.events
         where plan_id = '${planId}' and event_name = 'organiser_accepted'`),
  ).toEqual([[tom.userId, '{}']]);
});

test('an ask that runs out is "closed quietly" to Maya and nothing to anybody else', async ({
  browser,
}) => {
  const { circleId, maya, tom } = await threeOfUs(browser);
  const planId = await mayaAsks(maya, circleId);

  // Past its stop time: the view says closed from then, before any sweep.
  sql(`
    begin;
    select set_config('circles.in_transition', 'on', true);
    update public.plans set quiet_expires_at = now() - interval '1 minute' where id = '${planId}';
    commit;
  `);

  await maya.page.reload();
  await expect(maya.page.getByText('Not enough people were free this time.')).toBeVisible();
  await expect(maya.page.getByRole('button', { name: 'Try again another time' })).toBeVisible();

  await tom.page.goto(`/circles/${circleId}/quiet/${planId}`);
  await expect(tom.page.getByText("This isn't open any more.")).toBeVisible();
  await expect(tom.page.getByText('Not enough people were free this time.')).toHaveCount(0);
  await tom.page.goto(`/circles/${circleId}`);
  await expect(tom.page.getByText('Asked quietly')).toHaveCount(0);

  expectNothingConnects(maya, maya, tom);
});
