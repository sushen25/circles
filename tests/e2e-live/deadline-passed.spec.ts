import { expect, test, type Page } from './fixtures';

import { letterTo, lettersTo, linkIn, runDispatcher } from './mail';
import {
  accountToSignInTo,
  circleOwnedBy,
  guestWhoAnswered,
  planFor,
  sessionStorageKey,
  signedInAccount,
  sql,
  type Scenario,
} from './stack';

/**
 * Replies closed with no decision, end to end (spec §5.7, S2-05).
 *
 * The deadline passes with an option on offer and nothing locked in. The
 * organiser is told by email, opens the letter, and takes one of the ways out:
 * one more day — after which the extended deadline closes and is announced
 * again, which is the letter SUS-36 found the job layer swallowing — or a
 * hand-off to a member with a saved place, who is told in turn.
 */

const CLOSED = /^Sunday Crew: replies are closed$/;

async function signedInAs(page: Page, stored: string): Promise<void> {
  await page.addInitScript({
    content: `localStorage.setItem(${JSON.stringify(sessionStorageKey())}, ${JSON.stringify(stored)});`,
  });
}

function addressOf(userId: string): string {
  return sql(`select email from auth.users where id = '${userId}'`)[0]![0]!;
}

/**
 * Maya's plan with one option — next week's second evening, Maya and Tom —
 * and then its deadline gone. Both answers are the product's own
 * (`replace_response`), and the engine is the dispatcher's, run until the plan
 * is ready: a set written by hand is stale the moment anything bumps the
 * plan's input, and the sweep then recalculates it from the real answers
 * underneath the test. Tom is a guest; Priya has a saved place, and the plan
 * is asking her but she has not answered.
 */
async function closedWithAnOption() {
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
  const priya = await accountToSignInTo('Priya');
  sql(`
    begin;
    insert into public.circle_members (circle_id, user_id, display_name_snapshot)
    values ('${circleId}', '${priya.userId}', 'Priya');
    insert into public.plan_participants (plan_id, revision, user_id)
    values ('${plan.id}', 1, '${priya.userId}');
    commit;
  `);
  const tom = guestWhoAnswered(crew, 'Tom');
  sql(`
    begin;
    select set_config('role', 'authenticated', true);
    select set_config('request.jwt.claims',
      '{"sub": "${maya.userId}", "role": "authenticated", "is_anonymous": false}', true);
    select public.replace_response('${plan.id}', 1, 'windows', jsonb_build_array(jsonb_build_object(
      'start', ((current_date + 8)::timestamp + interval '18 hours 30 minutes') at time zone 'Australia/Melbourne',
      'end', ((current_date + 8)::timestamp + interval '20 hours 30 minutes') at time zone 'Australia/Melbourne'
    )));
    commit;
  `);
  for (let attempt = 0; attempt < 20 && stateOf(plan.id) !== 'ready'; attempt += 1) {
    await runDispatcher();
  }
  expect(stateOf(plan.id)).toBe('ready');
  sql(
    `update public.plans set response_deadline = now() - interval '1 minute' where id = '${plan.id}'`,
  );
  return { maya, circleId, plan, tom, priya };
}

function stateOf(planId: string): string {
  return sql(`select state from public.plans where id = '${planId}'`)[0]![0]!;
}

async function closedLetters(address: string): Promise<number> {
  return (await lettersTo(address)).filter((letter) => CLOSED.test(letter.subject)).length;
}

test('the organiser is told, gives it one more day, and is told again when that closes', async ({
  page,
  baseURL,
}) => {
  const { maya, plan } = await closedWithAnOption();
  const address = addressOf(maya.userId);
  await signedInAs(page, maya.stored);

  // Two ticks: the sweep announces the deadline, the next drain writes and
  // sends the letter. `letterTo` runs the dispatcher until it arrives.
  const letter = await letterTo(address, CLOSED);
  await page.goto(linkIn(letter, new RegExp(`^/p/${plan.code}$`), baseURL!));

  await expect(page.getByText(/^Replies have closed\. .+ still works for two\.$/)).toBeVisible();
  await expect(page.getByText('Replies closed')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Lock in / })).toBeVisible();

  await page
    .getByRole('button', { name: /^Give it one more day\. Reopens replies until / })
    .click();

  // Replies are open again, so this is the options screen once more.
  await expect(page.getByText(/looks good for two of you\./)).toBeVisible();
  await expect(page.getByText(/^Closes /)).toBeVisible();
  expect(
    sql(`select deadline_extended_on_revision, response_deadline > now() + interval '23 hours'
         from public.plans where id = '${plan.id}'`),
  ).toEqual([['1', 't']]);

  // The extended deadline passes too, and it is announced: a second letter,
  // not a duplicate of the first.
  sql(
    `update public.plans set response_deadline = now() - interval '1 minute' where id = '${plan.id}'`,
  );
  for (let attempt = 0; attempt < 20 && (await closedLetters(address)) < 2; attempt += 1) {
    await runDispatcher();
    await page.waitForTimeout(500);
  }
  expect(await closedLetters(address)).toBe(2);

  // And the day, once given, is not offered again.
  await page.reload();
  const again = page.getByRole('button', {
    name: 'Give it one more day. It has had its extra day already.',
  });
  await expect(again).toBeVisible();
  await expect(again).toHaveAttribute('aria-disabled', 'true');
});

test('the organiser hands it to a member with a saved place, never to a guest', async ({
  page,
}) => {
  const { maya, circleId, plan, priya } = await closedWithAnOption();
  await signedInAs(page, maya.stored);

  await page.goto(`/circles/${circleId}/plan/${plan.id}/deadline`);
  await page.getByRole('button', { name: /^Hand this to someone else/ }).click();

  const tom = page.getByRole('button', { name: 'Tom. Needs a saved place' });
  await expect(tom).toBeVisible();
  await expect(tom).toHaveAttribute('aria-disabled', 'true');
  await page.getByRole('button', { name: 'Priya', exact: true }).click();
  await expect(page.getByText('Hand it to Priya?')).toBeVisible();
  await page.getByRole('button', { name: 'Hand it to Priya' }).click();

  // Maya is a member of it now, and sees it as one.
  await expect(page.getByText('Replies have closed. Priya picks one of these.')).toBeVisible();
  const change = page.getByRole('button', { name: 'Change my times' });
  await expect(change).toHaveAttribute('aria-disabled', 'true');
  expect(sql(`select organiser_user_id from public.plans where id = '${plan.id}'`)[0]![0]).toBe(
    priya.userId,
  );

  // Priya is told it is hers, with the letter that opens the three ways out.
  await letterTo(priya.email, CLOSED);
});
