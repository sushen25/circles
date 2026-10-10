// @e2e: core
import { expect, test } from './fixtures';
import { addressFor, joinsAndAnswers, subscribesFromSent } from './journeys';
import { letterTo, lettersTo, linkIn, runDispatcher } from './mail';
import {
  consentVersionOf,
  emailContactOf,
  isAnonymousUser,
  latestCodeFor,
  lockInFirstOption,
  memberNamed,
  prefsTokenFor,
  subscriptionOf,
  sundayCrew,
} from './stack';

/**
 * After an answer: the email offer, the verification link, the preferences
 * page and saving a place (spec §5.1, §5.8, S1-30). The letters are the ones
 * the stack actually sends — the dispatcher run once, the message read out of
 * the mail catcher (`mail.ts`) — and the links in them are opened in a **fresh
 * browser**, because that is where an email link lands. Their tokens ride in
 * the fragment, which the suite's guard holds every request to (ADR 0023).
 *
 * "Not now" on the offer is `guest.spec.ts`, at the end of the journey.
 */

test('the verification email’s link verifies the address, in a browser with no session', async ({
  page,
  browser,
  baseURL,
}) => {
  const crew = sundayCrew();
  const ren = await joinsAndAnswers(page, crew, 'Ren');
  const address = addressFor('ren');

  await page.getByLabel('Your email').fill(address);
  await page.getByRole('switch', { name: /^Save my place in/ }).click();
  await page.getByRole('button', { name: 'Email me about this meetup' }).click();
  await expect(page.getByText('Check your email.')).toBeVisible();
  await expect(page.getByText(`We sent a link to ${address}.`, { exact: false })).toBeVisible();
  expect(emailContactOf(ren)).toBe('pending');

  const letter = await letterTo(address, /^Turn on updates/);
  const link = linkIn(letter, '/v', baseURL!);

  const elsewhere = await browser.newContext();
  const mail = await elsewhere.newPage();
  await mail.goto(link);
  await expect(mail.getByText("You'll hear about this meetup by email.")).toBeVisible();
  await expect(mail.getByText('Sunday Crew · Catch up')).toBeVisible();
  expect(emailContactOf(ren)).toBe('verified');
  expect(subscriptionOf(ren, crew.planId)).toBe('active');
  expect(await mail.evaluate('location.hash')).toBe('');

  // Single use: the same link again says so, neutrally.
  await mail.goto(link);
  await expect(mail.getByText('This link has expired.')).toBeVisible();
  await elsewhere.close();
});

test('stopping one meetup from the preferences page means its lock-in sends that address nothing', async ({
  page,
  browser,
}) => {
  const crew = sundayCrew();
  const renAddress = addressFor('ren');
  const jessAddress = addressFor('jess');

  // Two people ask for updates. Jess keeps hers, and is the proof that the
  // lock-in did send.
  const ren = await joinsAndAnswers(page, crew, 'Ren');
  await subscribesFromSent(page, renAddress);
  const jessPhone = await browser.newContext();
  const jessPage = await jessPhone.newPage();
  await joinsAndAnswers(jessPage, crew, 'Jess');
  await subscribesFromSent(jessPage, jessAddress);
  await jessPhone.close();

  // Ren's preferences, from an email, with no session.
  const token = prefsTokenFor(ren);
  const elsewhere = await browser.newContext();
  const mail = await elsewhere.newPage();
  await mail.goto(`/e#${token}`);
  const toggle = mail.getByRole('switch', { name: 'Sunday Crew · Catch up' });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  expect(subscriptionOf(ren, crew.planId)).toBe('withdrawn');

  // Maya locks it in. Jess hears; Ren does not.
  lockInFirstOption(crew.planId, crew.ownerId);
  await letterTo(jessAddress, /^Locked in: Sunday Crew/);
  await runDispatcher();
  const toRen = (await lettersTo(renAddress)).map((letter) => letter.subject);
  expect(toRen.filter((subject) => /^Locked in/.test(subject))).toEqual([]);

  // And the address can go altogether, from the same page.
  await mail.getByRole('button', { name: 'Remove this email address entirely' }).click();
  await mail.getByRole('button', { name: 'Remove my email address' }).click();
  await expect(mail.getByText('Your email address is gone.')).toBeVisible();
  expect(emailContactOf(ren)).toBeUndefined();
  await elsewhere.close();
});

test('one step: the switch on saves the place and turns on the updates, with one email and no link', async ({
  page,
  browser,
}) => {
  const crew = sundayCrew();
  const ren = await joinsAndAnswers(page, crew, 'Ren');
  const address = addressFor('ren');

  await page.getByLabel('Your email').fill(address);
  await expect(page.getByRole('switch', { name: /^Save my place in/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.getByRole('button', { name: 'Email me about this meetup' }).click();
  await expect(page.getByText('Enter the code we emailed')).toBeVisible();

  await page.getByLabel('Code', { exact: true }).fill(await latestCodeFor(address));
  await page.getByRole('button', { name: 'Continue' }).click();

  // Back on Sent, one line, and the card is gone.
  await expect(page.getByRole('status')).toContainText(
    `Done. We'll email ${address} about this meetup`,
  );
  await expect(page.getByText("Hear when it's locked in")).toHaveCount(0);
  expect(isAnonymousUser(ren), 'the same identity, now an account').toBe(false);
  expect(memberNamed(crew.circleId, 'Ren')?.userId).toBe(ren);
  // A confirmed sign-in address is its own proof: verified, subscribed, nothing sent.
  expect(emailContactOf(ren)).toBe('verified');
  expect(subscriptionOf(ren, crew.planId)).toBe('active');
  expect(consentVersionOf(ren, crew.planId)).toBe('2026-10-06');
  await runDispatcher();
  expect(
    (await lettersTo(address))
      .map((letter) => letter.subject)
      .filter((s) => /^Turn on updates/.test(s)),
  ).toEqual([]);

  // A second answer, so there is a set to lock in. Then the locked-in letter
  // arrives, with no verification email before it.
  const jessPhone = await browser.newContext();
  await joinsAndAnswers(await jessPhone.newPage(), crew, 'Jess');
  await jessPhone.close();
  lockInFirstOption(crew.planId, crew.ownerId);
  await letterTo(address, /^Locked in: Sunday Crew/);
  const subjects = (await lettersTo(address)).map((letter) => letter.subject);
  expect(subjects.filter((subject) => /^Turn on updates/.test(subject))).toEqual([]);
});
