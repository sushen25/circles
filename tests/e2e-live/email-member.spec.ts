// @e2e: core
import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';
import { addressFor, joinsAndAnswers, sendEvenings } from './journeys';
import { lettersTo, runDispatcher } from './mail';
import {
  consentVersionOf,
  emailContactOf,
  latestCodeFor,
  planFor,
  sql,
  subscriptionOf,
  sundayCrew,
  type Scenario,
} from './stack';

/**
 * After an answer, for somebody signed in with a confirmed address (SUS-164,
 * ADR 0055): their address as text and one button, no field and no switch; one
 * tap turns the plan's emails on and sends nothing. And the owner of an address
 * that cannot be emailed is told so, on that button and after the code, and is
 * never promised a letter. The server's allow and deny is pgTAP 350's.
 */

const PRIMARY = 'Email me about this meetup';

/** A guest saves their place through the card's code, which leaves them signed in with a confirmed address. */
async function savesAPlace(page: Page, crew: Scenario, name: string, address: string) {
  const userId = await joinsAndAnswers(page, crew, name);
  await page.getByLabel('Your email').fill(address);
  await page.getByRole('button', { name: PRIMARY }).click();
  await expect(page.getByText('Enter the code we emailed')).toBeVisible();
  await page.getByLabel('Code', { exact: true }).fill(await latestCodeFor(address));
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('status')).toContainText('about this meetup');
  return userId;
}

/** The same person answers a second plan in the circle: the signed-in member's Sent. */
async function answersAnotherPlan(page: Page, crew: Scenario) {
  // A circle asks one thing at a time: the first plan is called off.
  sql(`select planning.transition_plan('${crew.planId}', 'cancel', '${crew.ownerId}', '{}')`);
  const next = planFor(crew.circleId, crew.ownerId);
  await page.goto(`/j/${next.code}`);
  await sendEvenings(page, next.code);
  return next;
}

test('a signed-in member turns on the emails with one button, and no email is sent', async ({
  page,
}) => {
  const crew = sundayCrew();
  const address = addressFor('ren');
  const ren = await savesAPlace(page, crew, 'Ren', address);
  const next = await answersAnotherPlan(page, crew);

  // Their address as text, the sentence, one button; no field, no switch.
  await expect(page.getByText(`We'll email you at ${address}.`)).toBeVisible();
  await expect(page.getByLabel('Your email')).toHaveCount(0);
  await expect(page.getByRole('switch')).toHaveCount(0);
  await expect(page.getByText(/different address/i)).toHaveCount(0);
  await page.getByRole('button', { name: PRIMARY }).click();

  await expect(page.getByRole('status')).toContainText(
    `Done. We'll email ${address} about this meetup.`,
  );
  await expect(page).toHaveURL(new RegExp(`/j/${next.code}/sent$`));
  await expect(page.getByText('Check your email.')).toHaveCount(0);
  expect(subscriptionOf(ren, next.id)).toBe('active');
  expect(consentVersionOf(ren, next.id)).toBe('2026-10-06');
  expect(emailContactOf(ren)).toBe('verified');
  await runDispatcher();
  expect(
    (await lettersTo(address)).map((letter) => letter.subject).filter((s) => /^Turn on/.test(s)),
  ).toEqual([]);
});

test('the owner of a suppressed address is told, and promised nothing', async ({ page }) => {
  const crew = sundayCrew();
  const address = addressFor('sam');
  const sam = await savesAPlace(page, crew, 'Sam', address);
  // The address bounces after the place is saved.
  sql(`update private.email_contacts
    set status = 'suppressed', suppression_reason = 'bounced', suppressed_at = now(), verified_at = null
    where user_id = '${sam}'`);
  const next = await answersAnotherPlan(page, crew);

  await page.getByRole('button', { name: PRIMARY }).click();

  const status = page.getByRole('status');
  await expect(status).toContainText(
    `We can't send email to ${address} right now, so check the plan here.`,
  );
  await expect(status).not.toContainText("We'll email");
  await expect(page.getByText(/^Done\./)).toHaveCount(0);
  expect(subscriptionOf(sam, next.id)).toBeUndefined();
});

test('the switch-on path ends the same way for a suppressed address', async ({ page }) => {
  const crew = sundayCrew();
  const address = addressFor('kit');
  sql(`insert into private.email_suppressions (email_hash, reason)
    values (extensions.digest('${address}', 'sha256'), 'bounced')`);
  await joinsAndAnswers(page, crew, 'Kit');
  await page.getByLabel('Your email').fill(address);
  await page.getByRole('button', { name: PRIMARY }).click();
  await expect(page.getByText('Enter the code we emailed')).toBeVisible();
  await page.getByLabel('Code', { exact: true }).fill(await latestCodeFor(address));
  await page.getByRole('button', { name: 'Continue' }).click();

  const status = page.getByRole('status');
  await expect(status).toContainText(
    `Your place is saved. We can't send email to ${address} right now, so check the plan here.`,
  );
  await expect(status).not.toContainText("We'll email");
});
