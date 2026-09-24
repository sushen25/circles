import { expect, type Page } from './fixtures';
import { letterTo, linkIn } from './mail';
import { memberNamed, sessionStorageKey, type Scenario } from './stack';

/**
 * The steps several specs walk on the way to the thing they are about. Each is
 * the product's own path — the screens, not SQL — because the step is a person
 * doing it; a spec that is *about* one of these walks it inline instead.
 */

/** The plan's days, in the grid, in date order. */
export const days = (page: Page) =>
  page.getByRole('group', { name: 'Days in this plan' }).getByRole('button');

/** On the editor: ticks `indices`, turns Evening on, and sends. Waits for Sent. */
export async function sendEvenings(page: Page, code: string, ...indices: number[]): Promise<void> {
  await expect(page.getByText("Times I'd actually be up for")).toBeVisible();
  for (const index of indices.length === 0 ? [1] : indices) {
    await days(page).nth(index).click();
    await expect(days(page).nth(index)).toHaveAttribute('aria-pressed', 'true');
  }
  await page.getByRole('checkbox', { name: /^Evening/ }).click();
  await page.getByRole('button', { name: 'Send my times' }).click();
  await expect(page).toHaveURL(new RegExp(`/j/${code}/sent$`));
  // Sent itself, not only its URL: a hard navigation straight after the client
  // one, with Sent's requests still in flight, crashed WebKit in CI.
  await expect(page.getByText(/Your times are in\./)).toBeVisible();
}

/**
 * A stranger on the plan link with nobody to continue as: the name, then the
 * editor, then Sent. Returns the new member's id.
 */
export async function joinsAndAnswers(page: Page, crew: Scenario, name: string): Promise<string> {
  await page.goto(`/j/${crew.planCode}`);
  const newHere = page.getByRole('button', { name: "I'm new here" });
  // Offered only when the circle has guests to continue as (ADR 0006).
  await expect(page.getByLabel('Your name').or(newHere)).toBeVisible();
  if (await newHere.isVisible()) await newHere.click();
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(new RegExp(`/j/${crew.planCode}$`));
  await sendEvenings(page, crew.planCode);
  await expect(page.getByText(`Thanks, ${name}. Your times are in.`)).toBeVisible();
  return memberNamed(crew.circleId, name)!.userId;
}

/**
 * From Sent: asks for updates at `address`, and opens the verification link from
 * the email the stack actually sent, in the same browser. Returns once the
 * address is verified.
 */
export async function subscribesFromSent(page: Page, address: string): Promise<void> {
  await page.getByLabel('Your email').fill(address);
  await page.getByRole('button', { name: 'Send verification email' }).click();
  await expect(page.getByText('Check your email.')).toBeVisible();
  const letter = await letterTo(address, /^Turn on updates/);
  await page.goto(linkIn(letter, '/v', page.url()));
  await expect(page.getByText("You'll hear about this meetup by email.")).toBeVisible();
}

/** Puts an account's session where `supabase-js` looks for it, before the page loads. */
export async function signedInAs(page: Page, stored: string): Promise<void> {
  await page.addInitScript({
    content: `localStorage.setItem(${JSON.stringify(sessionStorageKey())}, ${JSON.stringify(stored)});`,
  });
}

/** A unique address per run, so the per-address limits never carry over. */
export const addressFor = (name: string) =>
  `${name.toLowerCase()}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.test`;
