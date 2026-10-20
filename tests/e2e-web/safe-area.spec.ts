import { expect, test, type Page } from '@playwright/test';

/**
 * `viewport-fit=cover` (SUS-235): the page runs under the iPhone's status bar
 * and toolbar, so the app pads the safe area itself. Desktop browsers report
 * zero insets, so they are simulated, two ways:
 *
 * - The app reads insets through `react-native-safe-area-context`, whose web
 *   provider measures a hidden element padded with `env(safe-area-inset-*)`.
 *   `simulateInsets` answers that one element's computed padding with the
 *   given insets, as a notched iPhone would, so the real provider, hook and
 *   components run.
 * - The landing page is static HTML and reads `env()` through four custom
 *   properties on `:root`; the test overrides those.
 */
const INSETS = { top: 47, right: 0, bottom: 34, left: 0 };

async function simulateInsets(page: Page, insets = INSETS) {
  await page.addInitScript((inset) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = globalThis as any;
    const real = win.getComputedStyle.bind(win);
    win.getComputedStyle = (el: unknown, pseudo?: string) => {
      const style = real(el, pseudo);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const own = (el as any)?.style?.paddingBottom as string | undefined;
      if (!own || !own.includes('safe-area-inset-bottom')) return style;
      const sides: Record<string, number> = {
        paddingTop: inset.top,
        paddingRight: inset.right,
        paddingBottom: inset.bottom,
        paddingLeft: inset.left,
      };
      return new Proxy(style, {
        get(target, prop) {
          if (typeof prop === 'string' && prop in sides) return `${sides[prop]}px`;
          const value = Reflect.get(target, prop, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    };
  }, insets);
}

/** The lowest edge of the controls inside the open sheet (the scrim, which spans the window, is not one). */
async function lowestControl(page: Page): Promise<number> {
  return page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = (globalThis as any).document;
    const dialog = doc.querySelector('[role="dialog"], [aria-modal="true"]');
    const tall = doc.documentElement.clientHeight / 2;
    const bottoms = [...dialog.querySelectorAll('button, [role="button"], [role="radio"], a')]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((el: any) => el.getBoundingClientRect())
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((box: any) => box.height > 0 && box.height < tall)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((box: any) => box.bottom);
    return bottoms.length > 0 ? Math.max(...bottoms) : -1;
  });
}

for (const width of [390, 375]) {
  test.describe(`at ${width} wide, with a ${INSETS.bottom}px bottom inset`, () => {
    test.use({ viewport: { width, height: 812 } });

    test('the hours sheet and its picker keep their last control clear of the home indicator', async ({
      page,
    }) => {
      await simulateInsets(page);
      await page.clock.setFixedTime(new Date('2026-10-12T09:00:00+11:00'));
      await page.goto('/j/abc');
      const tuesday = page.getByRole('button', { name: /^Tuesday\D*15\D/ });
      await expect(async () => {
        await tuesday.click();
        await expect(tuesday).toHaveAttribute('aria-pressed', 'true', { timeout: 1000 });
      }).toPass();
      await page.getByRole('button', { name: 'Adjust hours', exact: true }).click();

      await page.getByRole('button', { name: /^Exact hours, Tuesday/ }).click();
      const done = page.getByRole('button', { name: 'Done', exact: true });
      await expect(done).toBeVisible();
      // The sheet slides in; measure once it has stopped.
      await page.waitForTimeout(600);
      const lowest = await lowestControl(page);
      expect(lowest).toBeGreaterThan(400); // something was measured
      expect(lowest).toBeLessThanOrEqual(812 - INSETS.bottom);

      const until = page.getByRole('button', { name: /^Free until, Tuesday/ });
      await until.click();
      const last = page.getByRole('radio').last();
      await last.scrollIntoViewIfNeeded();
      await page.waitForTimeout(600);
      const pickerLowest = await lowestControl(page);
      expect(pickerLowest).toBeGreaterThan(400); // something was measured
      expect(pickerLowest).toBeLessThanOrEqual(812 - INSETS.bottom);
    });

    test('a screen footer is lifted by the inset exactly once', async ({ page, browser }) => {
      const lowest = async (p: Page) => {
        await p.goto('/start');
        await expect(p.getByRole('button').last()).toBeVisible();
        const box = (await p.getByRole('button').last().boundingBox())!;
        return box.y + box.height;
      };
      const without = await lowest(page);
      const context = await browser.newContext({ viewport: { width, height: 812 } });
      const padded = await context.newPage();
      await simulateInsets(padded);
      const withInset = await lowest(padded);
      await context.close();
      // Clear of the indicator, and moved by the inset and no more: Screen pads
      // once, and nothing inside it pads again.
      expect(withInset).toBeLessThanOrEqual(812 - INSETS.bottom);
      expect(without - withInset).toBe(INSETS.bottom);
    });
  });
}

test('the app and the landing page both ask for viewport-fit=cover', async ({ page }) => {
  for (const path of ['/', '/circles']) {
    await page.goto(path);
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
      'content',
      /viewport-fit=cover/,
    );
  }
});

test('the landing page pads its header and close band by the insets', async ({ page }) => {
  await page.goto('/');
  const css = await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = (globalThis as any).document;
    return [...doc.querySelectorAll('style')]
      .map((s) => (s as { textContent: string }).textContent)
      .join('');
  });
  // Each property reads its own side.
  for (const [prop, side] of [
    ['sat', 'top'],
    ['sar', 'right'],
    ['sab', 'bottom'],
    ['sal', 'left'],
  ]) {
    expect(css).toContain(`--${prop}:env(safe-area-inset-${side}`);
  }
  const before = await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = (globalThis as any).document;
    return {
      header: parseFloat(doc.defaultView.getComputedStyle(doc.querySelector('header')).paddingTop),
      close: parseFloat(
        doc.defaultView.getComputedStyle(doc.querySelector('footer.close')).paddingBottom,
      ),
    };
  });
  await page.addStyleTag({
    content: ':root{--sat:47px;--sab:34px;--sal:0px;--sar:0px}',
  });
  const after = await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = (globalThis as any).document;
    return {
      header: parseFloat(doc.defaultView.getComputedStyle(doc.querySelector('header')).paddingTop),
      close: parseFloat(
        doc.defaultView.getComputedStyle(doc.querySelector('footer.close')).paddingBottom,
      ),
    };
  });
  expect(after.header - before.header).toBe(47);
  expect(after.close - before.close).toBe(34);
});
