import { expect, test, type Page } from '@playwright/test';

/**
 * The app on a wide window (SUS-202, manifesto 5.3): one centred column,
 * 480pt at most, shared by the top bar, the body and the fixed footer, with
 * the ground filling the rest. Phones are unchanged.
 */
const COLUMN = 480;
const SIZES = [
  { name: '390', width: 390, height: 844 },
  { name: '768', width: 768, height: 1024 },
  { name: '1280', width: 1280, height: 800 },
] as const;

/** Nothing is wider than the window, so nothing scrolls sideways or is cut off at its edge. */
async function expectNoSidewaysOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    // Typed loosely: the test project is compiled without the DOM library.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = globalThis as any;
    const document = win.document;
    const wide = document.documentElement.clientWidth;
    return {
      scroll: document.documentElement.scrollWidth - wide,
      cut: [...document.querySelectorAll('body *')]
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter((el: any) => {
          const box = el.getBoundingClientRect();
          return box.width > 0 && (box.left < -0.5 || box.right > wide + 0.5);
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((el: any) => `${el.tagName}.${el.className}`.slice(0, 80)),
    };
  });
  expect(overflow.scroll).toBeLessThanOrEqual(0);
  expect(overflow.cut).toEqual([]);
}

for (const size of SIZES) {
  test.describe(`at ${size.name}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('the heading, the footer button and the top bar share one column, centred', async ({
      page,
    }) => {
      await page.goto('/start');
      const heading = page.getByRole('heading', { name: /Who do you keep meaning to see/i });
      const button = page.getByRole('button', { name: 'Create circle' });
      await expect(heading).toBeVisible();
      await expect(button).toBeVisible();

      const h = (await heading.boundingBox())!;
      const b = (await button.boundingBox())!;
      const gutter = 22;
      const column = Math.min(size.width, COLUMN);
      const left = (size.width - column) / 2;

      // The body's text and the footer's button start and end on the same lines...
      expect(b.x).toBeCloseTo(h.x, 0);
      // ... which are the column's, inset by the gutter, and centred in the window.
      expect(b.x).toBeCloseTo(left + gutter, 0);
      expect(b.width).toBeCloseTo(column - 2 * gutter, 0);
      expect(b.x + b.width / 2).toBeCloseTo(size.width / 2, 0);
      // The top bar is the same column: its last action ends 16pt inside the column's edge.
      const signIn = (await page.getByRole('button', { name: 'Sign in' }).boundingBox())!;
      expect(signIn.x + signIn.width).toBeCloseTo(left + column - 16, 0);
      // The footer is still in view, on the bottom of the window.
      expect(b.y + b.height).toBeLessThanOrEqual(size.height);
      expect(b.y + b.height).toBeGreaterThan(size.height - 100);
      await expectNoSidewaysOverflow(page);
    });

    test('the confirmed screen keeps its inverted ground across the whole window', async ({
      page,
    }) => {
      await page.goto('/circles/sunday-crew/plan/thu-17/confirmed');
      await expect(page.getByText(/Locked in|Thu 17 Sep/i).first()).toBeVisible();
      const grounds = await page.evaluate(
        ({ width, height }) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const win = globalThis as any;
          const document = win.document;
          const ground = (x: number, y: number) => {
            for (let el = document.elementFromPoint(x, y); el !== null; el = el.parentElement) {
              const colour = win.getComputedStyle(el).backgroundColor;
              if (colour !== 'rgba(0, 0, 0, 0)') return colour;
            }
            return 'none';
          };
          return [
            ground(2, 2),
            ground(width - 3, 2),
            ground(2, height - 3),
            ground(width - 3, height - 3),
          ];
        },
        { width: size.width, height: size.height },
      );
      expect(grounds).toEqual(Array(4).fill('rgb(46, 36, 28)'));
      expect(grounds[0]).toBe('rgb(46, 36, 28)'); // color.invert
      await expectNoSidewaysOverflow(page);
    });

    test('Your hours each evening: heading, day lines and Done share the column, Done in view', async ({
      page,
    }) => {
      await page.clock.setFixedTime(new Date('2026-10-12T09:00:00+11:00'));
      await page.goto('/j/abc');
      const tuesday = page.getByRole('button', { name: /^Tuesday\D*15\D/ });
      await expect(async () => {
        await tuesday.click();
        await expect(tuesday).toHaveAttribute('aria-pressed', 'true', { timeout: 1000 });
      }).toPass();
      // The fixture plan is evenings only: one window, so no sheet, straight to the days.
      await page.getByRole('button', { name: /^Adjust hours for/ }).click();
      const heading = page.getByRole('heading', { name: 'Your hours each evening' });
      const done = page.getByRole('button', { name: 'Done', exact: true });
      await expect(heading).toBeVisible();
      await expect(done).toBeVisible();

      const h = (await heading.boundingBox())!;
      const d = (await done.boundingBox())!;
      const column = Math.min(size.width, COLUMN);
      expect(d.x).toBeCloseTo(h.x, 0);
      expect(d.width).toBeCloseTo(column - 2 * 22, 0);
      expect(d.x + d.width / 2).toBeCloseTo(size.width / 2, 0);
      expect(d.y + d.height).toBeLessThanOrEqual(size.height);
      await expectNoSidewaysOverflow(page);
    });
  });
}
