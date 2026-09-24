import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

import {
  circleOwnedBy,
  clearRateCounters,
  planFor,
  plansIn,
  sessionStorageKey,
  signedInAccount,
  stackConfig,
} from './stack';

/**
 * One open plan per circle (SUS-89, spec §5.3, ADR 00XX): with a plan already
 * finding a time, "Plan a catch-up" shows that plan with Edit and Cancel
 * instead of the setup form — from circle home, from the setup URL and from
 * the calendar URL — and the request the form would have sent is refused by
 * name. Calling the plan off frees the circle, and the form is back.
 *
 * The screens are S1-26's; what is new is which one the organiser lands on.
 */

test.beforeEach(() => {
  clearRateCounters();
});

async function asMaya(page: Page): Promise<{ userId: string; accessToken: string }> {
  const maya = await signedInAccount('Maya');
  await page.addInitScript({
    content: `localStorage.setItem(${JSON.stringify(sessionStorageKey())}, ${JSON.stringify(maya.stored)});`,
  });
  const session = JSON.parse(maya.stored) as { access_token: string };
  return { userId: maya.userId, accessToken: session.access_token };
}

/** The request "Ask the group" would have sent, sent anyway, as the organiser. */
async function askTheGroupAnyway(
  circleId: string,
  accessToken: string,
): Promise<{ status: number; reason: string | undefined }> {
  const { apiUrl, anonKey } = stackConfig();
  const response = await fetch(`${apiUrl}/functions/v1/create-plan`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      idempotency_key: randomUUID(),
      circle_id: circleId,
      title: 'Dinner',
      category: 'dinner',
      preset: 'next_7_days',
    }),
  });
  const body = (await response.json()) as { reason?: string };
  return { status: response.status, reason: body.reason };
}

test('a circle already finding a time shows that plan instead of a second form, and the server refuses a second plan', async ({
  page,
}) => {
  const maya = await asMaya(page);
  const circleId = circleOwnedBy(maya.userId, 'Sunday Crew');
  const plan = planFor(circleId, maya.userId);

  // Circle home's own button lands on the running plan, not a form.
  await page.goto(`/circles/${circleId}`);
  await page.getByRole('button', { name: 'Plan a catch-up' }).click();
  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/plan/setup$`));
  await expect(page.getByText('Sunday Crew is already finding a time')).toBeVisible();
  // Circle home stays mounted underneath on the web stack and says the same
  // count on its own card, so the setup screen's is the last one.
  await expect(page.getByText('0 of 1 replied').last()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ask the group' })).toHaveCount(0);

  // Edit and Cancel are S1-26's screens, for this plan.
  await page.getByRole('button', { name: 'Edit the plan' }).click();
  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/plan/${plan.id}/edit$`));
  await expect(page.getByRole('button', { name: 'Keep the plan as it is' })).toBeVisible();
  await page.goto(`/circles/${circleId}/plan/setup`);
  await page.getByRole('button', { name: 'Cancel the plan' }).click();
  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/plan/${plan.id}/cancel$`));
  await expect(page.getByRole('button', { name: 'Cancel the catch-up' })).toBeVisible();

  // The calendar URL is the same flow, and says the same thing.
  await page.goto(`/circles/${circleId}/plan/window`);
  await expect(page.getByText('Sunday Crew is already finding a time')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ask the group' })).toHaveCount(0);

  // The server, asked directly, refuses by name and makes nothing.
  expect(await askTheGroupAnyway(circleId, maya.accessToken)).toEqual({
    status: 409,
    reason: 'plan_in_progress',
  });
  expect(plansIn(circleId).map((p) => p.state)).toEqual(['collecting']);

  // Called off, the circle is free: the form is back, and a plan can be made.
  await page.goto(`/circles/${circleId}/plan/${plan.id}/cancel`);
  await page.getByRole('button', { name: 'Cancel the catch-up' }).click();
  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/plan/${plan.id}/cancelled$`));
  await page.goto(`/circles/${circleId}/plan/setup`);
  await page.getByRole('button', { name: 'Ask the group' }).click();
  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/plan/[^/]+/shared$`));
  expect(plansIn(circleId).map((p) => p.state)).toEqual(['cancelled', 'collecting']);
});
