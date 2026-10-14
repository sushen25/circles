// @e2e: core
import { expect, test, type Page } from './fixtures';
import { days, sendEvenings } from './journeys';
import { sundayCrew, type Scenario } from './stack';

/**
 * What the others have said, as counts on the editor (SUS-129, ADR 0045):
 * read from `others_availability` as the guest, worked out by the domain, and
 * never with a name beside it.
 *
 * Three strangers arrive on the plan link in turn. The first has no
 * number to be shown; the third sees the first two answers as counts — on the tiles, in the
 * words of each day, and over the open day's half hours — and neither of their
 * names.
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
  await expect(page.getByText('Which days could work?')).toBeVisible();
}

test('a third guest sees the first two answers as counts, and no name', async ({
  page,
  browser,
}) => {
  const crew = sundayCrew();

  // Ren is first: there is no number to explain, so the line says only what to
  // do, and no tile carries a figure instead of a row of noughts.
  await arrives(page, crew, 'Ren');
  await expect(page.getByText("Tap every day you'd be up for.", { exact: true })).toBeVisible();
  await expect(days(page).nth(1)).not.toHaveAccessibleName(/could make it/);
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
      "Tap every day you'd be up for. The number is how many people can make it, you included once you tap.",
    ),
  ).toBeVisible();
  // In words on each day, and as a figure on the tile; a muted zero where neither picked.
  await expect(days(lous).nth(0)).not.toHaveAccessibleName(/could make it/);
  await expect(days(lous).nth(0)).toContainText('0');
  await expect(days(lous).nth(1)).toHaveAccessibleName(/, 1 other could make it$/);
  await expect(days(lous).nth(3)).toHaveAccessibleName(/, 2 others could make it$/);
  await expect(days(lous).nth(5)).toHaveAccessibleName(/, 1 other could make it$/);

  // The fourth day, tapped: both of them, and Lou makes three.
  await days(lous).nth(3).click();
  await expect(days(lous).nth(3)).toHaveAccessibleName(/, you and 2 others can make it$/);
  await expect(days(lous).nth(3)).toContainText('3');
  // With the first day too: nobody else is free on it, so it is only Lou.
  await days(lous).nth(0).click();
  await expect(days(lous).nth(0)).toHaveAccessibleName(/, only you so far$/);
  await expect(days(lous).nth(0)).toContainText('1');

  // The half hours, from each day's card: the first day meets nobody, the
  // fourth both.
  await lous.getByRole('button', { name: /^Change the time for/ }).click();
  await lous.getByRole('button', { name: 'A different time for each day' }).click();
  const lines = lous.getByRole('button', { name: /Adjust by the half hour/ });
  await lines.nth(0).click();
  await expect(lous.getByText('Nobody else has picked this day yet.')).toBeVisible();
  await lines.nth(1).click();
  await expect(
    lous.getByText(/^Others free, by the half hour\. The most is 2, 5:30.10:30\spm\.$/),
  ).toBeVisible();
  await expect(lous.getByRole('checkbox', { name: /\. 2 others free$/ }).first()).toBeVisible();
  await lous.getByRole('button', { name: 'Done', exact: true }).click();

  // Counts, never names: neither Ren nor Kit is anywhere on Lou's screen.
  const text = await lous.locator('body').innerText();
  expect(text).not.toMatch(/\bRen\b/);
  expect(text).not.toMatch(/\bKit\b/);

  // And Lou's answer is still only Lou's to send.
  await lous.getByRole('button', { name: 'Send my times' }).click();
  await expect(lous).toHaveURL(new RegExp(`/j/${crew.planCode}/sent$`));
});
