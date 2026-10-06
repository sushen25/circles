import { expect, type Download, type Page } from './fixtures';
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

/**
 * On the open "Add to my calendar" sheet: taps "Apple or device calendar" and
 * returns the download it starts (SUS-163).
 *
 * The sheet fetches the file when it opens, and the row ignores taps until the
 * file is here (`useCalendar`: Safari hands a download to Calendar only from a
 * tap it can see, so the save happens synchronously inside the tap). A tap
 * made while the row is `aria-busy` is swallowed and no download ever starts,
 * so `waitForEvent` sat out the whole test timeout whenever the fetch was slow
 * - under load, and in CI. Waiting for the row to be ready is waiting for what
 * the person waits for, and needs no longer timeout.
 */
export async function downloadCalendarFile(page: Page): Promise<Download> {
  const row = page.getByRole('button', { name: /^Apple or device calendar/ });
  await expect(row).toHaveAttribute('aria-busy', 'false');
  const download = page.waitForEvent('download');
  await row.click();
  return download;
}

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
 * From Sent, with the "Save my place" switch off: asks for updates at `address`, and opens the verification link from
 * the email the stack actually sent, in the same browser. Returns once the
 * address is verified.
 */
export async function subscribesFromSent(page: Page, address: string): Promise<void> {
  await page.getByLabel('Your email').fill(address);
  // The card's switch is on by default and saves a place; this is the other path.
  await page.getByRole('switch', { name: /^Save my place in/ }).click();
  await page.getByRole('button', { name: 'Email me about this meetup' }).click();
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
