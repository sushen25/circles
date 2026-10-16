// @e2e: core
import { expect, test, type Page } from './fixtures';
import { metSql } from './cadence-seed';
import { circleOwnedBy, sessionStorageKey, signedInAccount, sql } from './stack';

/**
 * Plan another's summary card (SUS-225): last time was three hours, at least
 * two of five, so the summary is the longest line the card ever holds. The
 * words wrap and Change stays inside the card, at the widths phones come in.
 * SettingLine is shared with the change-time screen and plan setup, which hold
 * the same two pieces; the card's layout is one component.
 */
const TITLE = '3 hrs · At least 2 of 5 need to make it';

async function seedLongSummary(): Promise<{ stored: string; circleId: string }> {
  const maya = await signedInAccount('Maya');
  const others = [
    await signedInAccount('Nina'),
    await signedInAccount('Tom'),
    await signedInAccount('Jess'),
    await signedInAccount('Sam'),
  ];
  const circleId = circleOwnedBy(maya.userId, 'Sunday Crew');
  const names = ['Nina', 'Tom', 'Jess', 'Sam'];
  sql(`insert into public.circle_members (circle_id, user_id, display_name_snapshot) values
    ${others.map((o, i) => `('${circleId}', '${o.userId}', '${names[i]}')`).join(', ')}`);
  sql(
    `begin; ${metSql(circleId, maya.userId, [maya.userId, others[0]!.userId], 26, { minutes: 180, quorum: 2 })} commit;`,
  );
  return { stored: maya.stored, circleId };
}

async function box(locator: ReturnType<Page['locator']>) {
  const at = await locator.boundingBox();
  if (at === null) throw new Error('not on screen');
  return at;
}

for (const width of [390, 320]) {
  test(`Change stays inside the card at ${width} wide when the summary is long`, async ({
    page,
  }) => {
    const { stored, circleId } = await seedLongSummary();
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript({
      content: `localStorage.setItem(${JSON.stringify(sessionStorageKey())}, ${JSON.stringify(stored)});`,
    });
    await page.goto(`/circles/${circleId}/plan/another`);

    const title = page.getByText(TITLE);
    await expect(title).toBeVisible();
    const change = page.getByRole('button', { name: 'Change' });
    const card = page
      .locator('div')
      .filter({ has: change })
      .filter({ hasText: /Replies close in/ })
      .last();

    const c = await box(card);
    const b = await box(change);
    const t = await box(title);
    expect(b.x).toBeGreaterThanOrEqual(c.x);
    expect(b.x + b.width).toBeLessThanOrEqual(c.x + c.width + 0.5);
    // The words stop short of the button rather than running under it.
    expect(t.x + t.width).toBeLessThanOrEqual(b.x + 0.5);
    // Level with the first line, not centred against both.
    expect(b.y).toBeLessThan(t.y + t.height);
  });
}
