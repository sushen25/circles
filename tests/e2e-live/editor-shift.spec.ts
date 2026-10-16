// @e2e: core
/**
 * The grid stays where it is when the others' counts arrive (SUS-136). The
 * guidance line grows when they do ("... The number is how many people can
 * make it ..."), which wrapped to more lines on a phone and pushed the grid
 * down under a finger. The screen now holds room for the longer line while the
 * read is on its way. Measured before the change: 23 px at 390 wide, 92 px at
 * 195 (200% browser zoom). A read that fails leaves the editor as it was.
 */
import { expect, test, type Page } from './fixtures';
import { days, sendEvenings } from './journeys';
import { sundayCrew, type Scenario } from './stack';

async function arrives(page: Page, crew: Scenario, name: string): Promise<void> {
  await page.goto(`/j/${crew.planCode}`);
  const newHere = page.getByRole('button', { name: "I'm new here" });
  await expect(page.getByLabel('Your name').or(newHere)).toBeVisible();
  if (await newHere.isVisible()) await newHere.click();
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Which evenings could work?')).toBeVisible();
}

const top = (page: Page) =>
  page
    .getByRole('group', { name: 'Days in this plan' })
    .evaluate((e) => e.getBoundingClientRect().top);

const LONG = /The number is how many people can make it/;

for (const width of [390, 195]) {
  test(`the day grid does not move when the counts arrive, at ${width} wide`, async ({
    page,
    browser,
  }) => {
    const crew = sundayCrew();
    await arrives(page, crew, 'Ren');
    await sendEvenings(page, crew.planCode, 1, 3);

    const kits = await (await browser.newContext()).newPage();
    await kits.setViewportSize({ width, height: 844 });
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let hits = 0;
    await kits.route('**/rpc/others_availability', async (route) => {
      hits += 1;
      await held;
      await route.continue();
    });
    await arrives(kits, crew, 'Kit');
    // The read is out, so the position below is the one before the counts.
    await expect.poll(() => hits).toBeGreaterThan(0);
    const before = await top(kits);
    release();
    await expect(days(kits).nth(1)).toHaveAccessibleName(/could make it$/);
    await expect(kits.getByText(LONG).last()).toBeVisible();
    expect(await top(kits)).toBe(before);
  });
}

test('a read that fails leaves the editor with the short line and no room held', async ({
  page,
}) => {
  const crew = sundayCrew();
  await page.route('**/rpc/others_availability', (route) => route.abort());
  await arrives(page, crew, 'Ren');
  await expect(
    page.getByText("Tap every evening you'd be up for, or drag across them.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(LONG)).toHaveCount(0);
});
