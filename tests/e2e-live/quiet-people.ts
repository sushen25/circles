import { randomUUID } from 'node:crypto';

import { expect, type Browser, type Page } from './fixtures';
import { signedInAs } from './journeys';
import { circleOwnedBy, signedInAccount, sql } from './stack';

/**
 * The people of `quiet.spec.ts`, and the ways they come to an ask.
 *
 * Each person is a saved place in a browser of their own, and every response
 * their page receives *about the ask* is kept, so that a test can search all
 * of it for anything that would connect the person who asked to the ask.
 */

export type Person = {
  userId: string;
  name: string;
  page: Page;
  seen: string[];
  quietEvents: string[];
};

/** The responses that are *about the ask*: where an initiator or an answer could leak. */
const ABOUT_THE_ASK =
  /\/(functions\/v1\/(quiet-view|create-plan|answer-interest|accept-organiser|cancel-plan)|rest\/v1\/plans)\b/;

export async function person(
  name: string,
): Promise<Omit<Person, 'page' | 'seen' | 'quietEvents'> & { stored: string }> {
  const { userId, stored } = await signedInAccount(name);
  return { userId, name, stored };
}

/** A browser of `who`'s own, signed in, keeping what it is told about the ask. */
export async function open(
  browser: Browser,
  who: { userId: string; name: string; stored: string },
): Promise<Person> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signedInAs(page, who.stored);
  return watched(page, who);
}

/** Keeps what `page` is told about the ask, and the ids of the quiet events it sends. */
export function watched(page: Page, who: { userId: string; name: string }): Person {
  const seen: string[] = [];
  const quietEvents: string[] = [];
  page.on('request', (request) => {
    if (!new URL(request.url()).pathname.endsWith('/functions/v1/track-events')) return;
    const body = JSON.parse(request.postData() ?? '{}') as {
      events?: { event_id: string; name: string }[];
    };
    for (const event of body.events ?? []) {
      if (event.name.startsWith('quiet_')) quietEvents.push(event.event_id);
    }
  });
  page.on('response', (response) => {
    if (!ABOUT_THE_ASK.test(new URL(response.url()).pathname)) return;
    void response
      .text()
      .then((body) => seen.push(body))
      .catch(() => undefined);
  });
  return { userId: who.userId, name: who.name, page, seen, quietEvents };
}

/** A circle of three saved places: Maya owns it, Tom and Jess are in it. */
export async function threeOfUs(browser: Browser) {
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
export async function mayaAsks(maya: Person, circleId: string): Promise<string> {
  await maya.page.goto(`/circles/${circleId}/plan/mode`);
  await maya.page.getByRole('button', { name: /^See if people are keen\./ }).click();
  await asksFromTheForm(maya.page);
  await expect(maya.page).toHaveURL(new RegExp(`/circles/${circleId}/quiet/[0-9a-f-]{36}$`));
  await expect(
    maya.page.getByText("We're checking who's keen for a catch-up in the next 7 days."),
  ).toBeVisible();
  // The threshold, from the view. No count, not even for her.
  await expect(maya.page.getByText('3 people are keen', { exact: true })).toBeVisible();
  return maya.page.url().split('/').at(-1)!;
}

/** On SparkSetup: the next seven days, the stop time it offers first, and Ask quietly. */
export async function asksFromTheForm(page: Page): Promise<void> {
  await expect(page.getByText(/^Nobody sees who asked\. If \d+ people are keen/)).toBeVisible();
  await page.getByRole('checkbox', { name: 'Next 7 days' }).click();
  await expect(page.getByRole('checkbox', { name: 'In two days' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.getByRole('button', { name: 'Ask quietly' }).click();
}

/** From circle home's card, which is the same for everybody. */
export async function answersKeen(
  member: Person,
  circleId: string,
  { opensIt = false }: { opensIt?: boolean } = {},
): Promise<void> {
  await member.page.goto(`/circles/${circleId}`);
  await expect(member.page.getByText('Asked quietly')).toBeVisible();
  await member.page.getByRole('button', { name: 'Take a look' }).click();
  await expect(
    member.page.getByText(
      /^Someone in [\w ]+ would be up for a catch-up in the next 7 days\. Would you\?$/,
    ),
  ).toBeVisible();
  await member.page.getByRole('button', { name: "I'm keen" }).click();
  // The view read again after the answer: the answer that opened it is met by
  // the opened ask, and any other by the same thanks whatever was said.
  await expect(
    opensIt
      ? member.page.getByText(
          /^\d people are keen to catch up in the next 7 days\.$|^Enough people are keen to catch up in the next 7 days\.$/,
        )
      : member.page.getByText("Thanks. We'll let you know if it opens up."),
  ).toBeVisible();
}

/** Nothing any of `everyone` was told about the ask names the one who asked, or an answer. */
export function expectNothingConnects(asker: { userId: string }, ...everyone: Person[]): void {
  for (const who of everyone) {
    const said = who.seen.join('\n');
    expect(said.length, `${who.name} read the ask`).toBeGreaterThan(0);
    expect(said, `nothing ${who.name} received names the one who asked`).not.toContain(
      asker.userId,
    );
    expect(said, `no key about who asked or who answered what`).not.toMatch(
      /initiator|"interested"|"my_answer"|"keen_by"|"answer"\s*:/,
    );
  }
}

/**
 * A quiet ask about the next seven days, made as `create-plan` makes one: the
 * service role's `create_quiet_ask` with the actor from the verified JWT. The
 * window and the stop time are ones the domain would offer (two to eight days
 * out, stopping in two). For tests about what happens *after* somebody asks;
 * asking itself is walked through the screens in `mayaAsks`.
 */
export function askedInSql(circleId: string, askerId: string): { id: string; code: string } {
  const [row] = sql(`
    select id, short_code from public.create_quiet_ask(
      '${askerId}', '${circleId}', 'Catch up', 'catch_up',
      current_date + 2, current_date + 8, 1050, 1350, 120, 'next_7_days',
      now() + interval '2 days'
    )
  `);
  return { id: row![0]!, code: row![1]! };
}

/**
 * `userId` answers "I'm keen", as `answer-interest` records it; the answer
 * that crosses the threshold opens the ask, with replies closing in two days.
 */
export function keenInSql(planId: string, userId: string): void {
  sql(`select public.record_interest('${planId}', '${userId}', true, now() + interval '2 days')`);
}

/** The address a saved place signed in with, which is where their organiser letters go. */
export function addressOf(userId: string): string {
  return sql(`select email from auth.users where id = '${userId}'`)[0]![0]!;
}
