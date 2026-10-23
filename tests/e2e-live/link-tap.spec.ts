// @e2e: core
import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';
import { addressFor, joinsAndAnswers } from './journeys';
import { letterTo, linkIn } from './mail';
import {
  emailContactOf,
  guestInvited,
  memberNamed,
  reentryTokenFor,
  subscriptionOf,
  sundayCrew,
} from './stack';

/**
 * The two single-use email links ask for a tap before they spend anything
 * (SUS-186, ADR 0023). A mail gateway that opens a link, runs the page's
 * script and waits must not verify an address a stranger typed, nor move a
 * guest's place onto its own throwaway identity. Three things per link: nothing
 * is spent on load, the tap spends it, and a second use is a replay or a
 * refusal that changes nothing.
 */

/** Every request the page makes to a function, by name. */
function watchFunctions(page: Page, name: string): string[] {
  const seen: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes(`/functions/v1/${name}`)) {
      seen.push(request.url());
    }
  });
  return seen;
}

test('/v: opening the verification link verifies nothing; the tap does, and a second use changes nothing', async ({
  page,
  browser,
  baseURL,
}) => {
  const crew = sundayCrew();
  const ren = await joinsAndAnswers(page, crew, 'Ren');
  const address = addressFor('ren');
  await page.getByLabel('Your email').fill(address);
  await page.getByRole('switch', { name: /^Save my place in/ }).click();
  await page
    .getByRole('button', { name: /^Email me (about this meetup|and save my place)$/ })
    .click();
  await expect(page.getByText('Check your email.')).toBeVisible();
  const link = linkIn(await letterTo(address, /^Turn on updates/), '/v', baseURL!);

  // A gateway: loads the page, runs its script, waits. Nothing is spent.
  const gateway = await (await browser.newContext()).newPage();
  const posted = watchFunctions(gateway, 'verify-email-contact');
  await gateway.goto(link);
  await expect(gateway.getByRole('button', { name: 'Turn on updates' })).toBeVisible();
  await gateway.waitForTimeout(1500);
  expect(posted, 'nothing posted on load').toEqual([]);
  expect(emailContactOf(ren)).toBe('pending');

  // The person taps: spent.
  await gateway.getByRole('button', { name: 'Turn on updates' }).click();
  await expect(gateway.getByText("You'll hear about this meetup by email.")).toBeVisible();
  expect(posted).toHaveLength(1);
  expect(emailContactOf(ren)).toBe('verified');
  expect(subscriptionOf(ren, crew.planId)).toBe('active');

  // Used again, anywhere: a replay. It says so, and nothing more happens.
  const again = await (await browser.newContext()).newPage();
  await again.goto(link);
  await again.getByRole('button', { name: 'Turn on updates' }).click();
  await expect(again.getByText('This link has expired.')).toBeVisible();
  expect(emailContactOf(ren)).toBe('verified');
  expect(subscriptionOf(ren, crew.planId)).toBe('active');
});

test('/a: opening the way back in moves nobody; the tap does, a lost answer is replayed, and a second use is refused', async ({
  browser,
}) => {
  const crew = sundayCrew();
  const tom = guestInvited(crew, 'Tom');
  const token = reentryTokenFor(crew, tom);

  // A gateway: loads the page, runs its script, waits. Tom's place stays put.
  const phone = await browser.newContext();
  const page = await phone.newPage();
  const posted = watchFunctions(page, 'reattach-member');
  await page.goto(`/a#${token}`);
  await expect(page.getByRole('button', { name: 'Get back in' })).toBeVisible();
  await page.waitForTimeout(1500);
  expect(posted, 'nothing posted on load').toEqual([]);
  expect(memberNamed(crew.circleId, 'Tom')?.userId).toBe(tom);

  // The tap spends it, but the answer is lost on the way back: the same key goes
  // again from "Try again" and is answered from the record, not spent twice.
  let lost = false;
  await page.route('**/functions/v1/reattach-member', async (route) => {
    if (lost) return route.continue();
    lost = true;
    await route.fetch();
    await route.abort('internetdisconnected');
  });
  await page.getByRole('button', { name: 'Get back in' }).click();
  await page.getByRole('button', { name: 'Try again' }).click();
  // The plan is asking for Tom's times, so the way back in lands on it.
  await expect(page).toHaveURL(new RegExp(`/j/${crew.planCode}$`));
  expect(posted).toHaveLength(2);
  const now = memberNamed(crew.circleId, 'Tom')?.userId;
  expect(now, 'Tom, under this browser’s identity').not.toBe(tom);
  await phone.close();

  // Another browser with the same link: spent, and Tom's place does not move again.
  const other = await (await browser.newContext()).newPage();
  await other.goto(`/a#${token}`);
  await other.getByRole('button', { name: 'Get back in' }).click();
  await expect(other.getByText('This link has expired.')).toBeVisible();
  expect(memberNamed(crew.circleId, 'Tom')?.userId).toBe(now);
});
