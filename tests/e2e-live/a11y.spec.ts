import { AxeBuilder } from '@axe-core/playwright';

import { expect, test, type Page } from './fixtures';
import { sendEvenings, signedInAs } from './journeys';
import {
  circleOwnedBy,
  guestInvited,
  guestWhoAnswered,
  lockInFirstOption,
  planFor,
  signedInAccount,
  sundayCrew,
} from './stack';

/**
 * Accessibility on the four screens a guest and an organiser cannot avoid
 * (spec §10, manifesto §6; S1-31): Join, the availability editor, the
 * organiser's options and a guest's confirmed screen. axe finds nothing at
 * `serious` or above, in every project.
 *
 * And the editor at 200% text: nothing a person decides with is cut off.
 */

/** axe's WCAG 2.1 A and AA rules, and only what it calls serious or critical. */
async function seriousViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return results.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map(
      (violation) =>
        `${violation.id} (${violation.impact}): ${violation.nodes
          .map((node) => node.target.join(' '))
          .join(', ')}`,
    );
}

test('Join has no serious accessibility violations', async ({ page }) => {
  const crew = sundayCrew();
  await page.goto(`/join#${crew.secret}`);
  await expect(page.getByText('Sunday Crew is finding a time to catch up.')).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});

test('the availability editor has no serious accessibility violations', async ({ page }) => {
  const crew = sundayCrew();
  await page.goto(`/j/${crew.planCode}`);
  await page.getByLabel('Your name').fill('Ren');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText("Times I'd actually be up for")).toBeVisible();
  // With a day open, so the half hours are in the tree too.
  await page.getByRole('group', { name: 'Days in this plan' }).getByRole('button').first().click();
  await page.getByRole('checkbox', { name: /^Evening/ }).click();
  await page
    .getByRole('button', { name: /Adjust by the half hour$/ })
    .first()
    .click();
  expect(await seriousViolations(page)).toEqual([]);
});

test("the organiser's options have no serious accessibility violations", async ({ page }) => {
  const maya = await signedInAccount('Maya');
  const circleId = circleOwnedBy(maya.userId, 'Sunday Crew');
  const plan = planFor(circleId, maya.userId);
  const crew = { circleId, planId: plan.id, planCode: plan.code, ownerId: maya.userId, secret: '' };
  guestWhoAnswered(crew, 'Tom');
  guestInvited(crew, 'Alex');
  await signedInAs(page, maya.stored);
  await page.goto(`/j/${plan.code}`);
  await sendEvenings(page, plan.code);

  await page.goto(`/circles/${circleId}/plan/${plan.id}/candidates`);
  await expect(page.getByText('Best attendance')).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});

test("a guest's confirmed screen has no serious accessibility violations", async ({ page }) => {
  const crew = sundayCrew();
  guestWhoAnswered(crew, 'Tom');
  await page.goto(`/j/${crew.planCode}`);
  await page.getByRole('button', { name: "I'm new here" }).click();
  await page.getByLabel('Your name').fill('Ren');
  await page.getByRole('button', { name: 'Continue' }).click();
  await sendEvenings(page, crew.planCode);
  lockInFirstOption(crew.planId, crew.ownerId);

  await page.goto(`/p/${crew.planCode}`);
  await expect(page).toHaveURL(new RegExp(`/p/${crew.planCode}/confirmed$`));
  await expect(page.getByText("You're going")).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});

test('at 200% text, the editor cuts off none of its decisions', async ({ page }, testInfo) => {
  const crew = sundayCrew();
  await page.goto(`/j/${crew.planCode}`);
  await page.getByLabel('Your name').fill('Ren');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText("Times I'd actually be up for")).toBeVisible();
  await page.getByRole('group', { name: 'Days in this plan' }).getByRole('button').first().click();

  // The browser's own text zoom: every size in the app is in CSS pixels
  // (react-native-web), so doubling the root size would change nothing, and
  // what a person with large text gets is the page at twice the scale — the
  // same layout as a phone half as wide.
  const viewport = page.viewportSize()!;
  await page.setViewportSize({
    width: Math.round(viewport.width / 2),
    height: Math.round(viewport.height / 2),
  });

  const decisions = [
    page.getByRole('checkbox', { name: /^Evening/ }),
    page.getByRole('switch', { name: "I'm easy" }),
    page.getByRole('button', { name: 'None of these dates work for me' }),
    page.getByRole('button', { name: 'Send my times' }),
  ];
  for (const decision of decisions) {
    await decision.scrollIntoViewIfNeeded();
    await expect(decision).toBeVisible();
    // Cut off, three ways: past the side of the screen; a word of its label
    // outside the control's own box (a label taller than a fixed-height
    // button, which RN-web leaves visible and spilling); or the control itself
    // cut by an ancestor that hides or scrolls its overflow.
    // Typed loosely: the test project is compiled without the DOM library.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const clipped = await decision.evaluate((el: any) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const page = globalThis as any;
      const doc = page.document;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const inside = (inner: any, outer: any) =>
        inner.left >= outer.left - 1 &&
        inner.right <= outer.right + 1 &&
        inner.top >= outer.top - 1 &&
        inner.bottom <= outer.bottom + 1;
      const box = el.getBoundingClientRect();
      const offScreen = box.left < -1 || box.right > doc.documentElement.clientWidth + 1;

      let spilling = false;
      const walker = doc.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
      for (let text = walker.nextNode(); text !== null; text = walker.nextNode()) {
        if (text.textContent.trim() === '') continue;
        const range = doc.createRange();
        range.selectNodeContents(text);
        for (const rect of range.getClientRects()) {
          // A line's trailing space can sit a few pixels past the edge it wraps
          // at; a word cannot be that narrow.
          if (rect.width > 4 && !inside(rect, box)) spilling = true;
        }
      }

      let cutByAncestor = false;
      for (let up = el.parentElement; up !== null; up = up.parentElement) {
        const style = page.getComputedStyle(up);
        if ([style.overflowX, style.overflowY].every((o: string) => o === 'visible')) continue;
        if (!inside(box, up.getBoundingClientRect())) cutByAncestor = true;
      }
      return { offScreen, spilling, cutByAncestor };
    });
    expect(clipped, String(decision)).toEqual({
      offScreen: false,
      spilling: false,
      cutByAncestor: false,
    });
  }
  await testInfo.attach('availability-at-200%', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
});
