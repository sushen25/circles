// @e2e: core
import { expect, test, type Page } from './fixtures';
import { days, sendEvenings } from './journeys';
import { sundayCrew, type Scenario } from './stack';

/**
 * What the others have said, as counts on the editor (SUS-129, ADR 0045):
 * read from `others_availability` as the guest, worked out by the domain, and
 * never with a name beside it.
 *
 * Three strangers arrive on the plan link in turn. The first is told they are
 * first; the third sees the first two answers as counts — on the days, on the
 * Evening chip, on the line of their answer and over the open day's half
 * hours — and neither of their names.
 */

/** A stranger on the plan link: the name, then the editor. */
async function arrives(page: Page, crew: Scenario, name: string): Promise<void> {
  await page.goto(`/j/${crew.planCode}`);
  const newHere = page.getByRole('button', { name: "I'm new here" });
  // Offered only when the circle has guests to continue as (ADR 0006).
  await expect(page.getByLabel('Your name').or(newHere)).toBeVisible();
  if (await newHere.isVisible()) await newHere.click();
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText("Times I'd actually be up for")).toBeVisible();
}

test('a third guest sees the first two answers as counts, and no name', async ({
  page,
  browser,
}) => {
  const crew = sundayCrew();

  // Ren is first, and is told so instead of being shown a row of noughts.
  await arrives(page, crew, 'Ren');
  await expect(page.getByText(/^You're the first to answer\./)).toBeVisible();
  await expect(days(page).nth(1)).toHaveAccessibleName(/, no times yet$/);
  await sendEvenings(page, crew.planCode, 1, 3);

  // Kit: the fourth and sixth days' evenings.
  const kits = await (await browser.newContext()).newPage();
  await arrives(kits, crew, 'Kit');
  await sendEvenings(kits, crew.planCode, 3, 5);

  // Lou: Maya, Ren, Kit and Lou are asked, and two have answered.
  const lous = await (await browser.newContext()).newPage();
  await arrives(lous, crew, 'Lou');
  await expect(
    lous.getByText(
      '2 of 4 have answered. The number on each day is how many of them could make it.',
    ),
  ).toBeVisible();
  // In words on each day; nothing on a day neither of them picked.
  await expect(days(lous).nth(0)).toHaveAccessibleName(/, no times yet$/);
  await expect(days(lous).nth(1)).toHaveAccessibleName(/, no times yet, 1 other could make it$/);
  await expect(days(lous).nth(3)).toHaveAccessibleName(/, no times yet, 2 others could make it$/);
  await expect(days(lous).nth(5)).toHaveAccessibleName(/, 1 other could make it$/);

  // The fourth day's Evening: both of them.
  await days(lous).nth(3).click();
  await expect(lous.getByRole('checkbox', { name: /^Evening, .*, 2 free$/ })).toBeVisible();
  // With the first day too, the days differ.
  await days(lous).nth(0).click();
  await expect(lous.getByRole('checkbox', { name: /^Evening, .*, Up to 2 free$/ })).toBeVisible();
  await lous.getByRole('checkbox', { name: /^Evening/ }).click();

  // The answer's lines: the first day meets nobody, the fourth both.
  const lines = lous.getByRole('button', { name: /Adjust by the half hour$/ });
  await expect(lines.nth(0)).toHaveAccessibleName(/\. No overlap with anyone yet\. /);
  await expect(lines.nth(1)).toHaveAccessibleName(/\. Overlaps with 2 others\. /);
  await lines.nth(1).click();
  await expect(
    lous.getByText(/^Others free, by the half hour\. The most is 2, 5:30.10:30\spm\.$/),
  ).toBeVisible();
  await expect(lous.getByRole('checkbox', { name: /\. 2 others free$/ }).first()).toBeVisible();

  // Counts, never names: neither Ren nor Kit is anywhere on Lou's screen.
  const text = await lous.locator('body').innerText();
  expect(text).not.toMatch(/\bRen\b/);
  expect(text).not.toMatch(/\bKit\b/);

  // And Lou's answer is still only Lou's to send.
  await lous.getByRole('button', { name: 'Send my times' }).click();
  await expect(lous).toHaveURL(new RegExp(`/j/${crew.planCode}/sent$`));
});
