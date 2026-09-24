import {
  expect,
  test as base,
  type Browser,
  type BrowserContext,
  type Page,
  type Request,
} from '@playwright/test';

import { clearRateCounters, mintedSecrets } from './stack';

export { expect };
export type { Browser, Page } from '@playwright/test';

/**
 * The live suite's `test`. Every spec in `tests/e2e-live/` imports it from here
 * rather than from `@playwright/test` (the lint rule in `eslint.config.mjs`
 * says so), because two things have to hold for every test, not only for the
 * ones that remember to ask:
 *
 * 1. **No request carries an invite secret** (S1-31's acceptance criterion,
 *    spec §8.2). Every secret the fixtures mint is registered in `stack.ts`,
 *    and every request from every page — the test's own and any browser it
 *    opens with `browser.newContext()` — is read for them. A secret in a URL
 *    fails the test wherever it appears; in a body, everywhere but the one call
 *    that exists to receive it, `redeem-invite`. The emailed tokens are held to
 *    the URL half (ADR 0023): their bodies go to the function that spends them.
 * 2. **A page is hydrated before the test touches it.** The web build is
 *    server-rendered (ADR 0001), so a field exists before React owns it, and
 *    WebKit is slow enough to show it: a name typed into the server's HTML is
 *    thrown away when React takes over, and the form then says the field is
 *    empty. `goto` and `reload` wait until React has attached to the page.
 *
 * Rate counters are cleared before each test too: every local request comes
 * from one address, and `redeem_ip` allows ten an hour.
 */

export type Leak = { url: string; where: 'url' | 'body' };

/** Every leak of a minted secret in `request`. */
export function leaksIn(request: Pick<Request, 'url' | 'method' | 'postData'>): Leak[] {
  const leaks: Leak[] = [];
  const url = request.url();
  const body = request.postData() ?? '';
  const toRedeem = request.method() === 'POST' && new URL(url).pathname.endsWith('/redeem-invite');
  for (const { value, kind } of mintedSecrets()) {
    if (url.includes(value) || url.includes(encodeURIComponent(value))) {
      leaks.push({ url, where: 'url' });
    } else if (kind === 'invite' && !toRedeem && body.includes(value)) {
      leaks.push({ url, where: 'body' });
    }
  }
  return leaks;
}

/** Waits until React has taken over the server-rendered page. */
async function hydrated(page: Page): Promise<void> {
  await page.waitForFunction(
    `(() => {
      const root = document.getElementById('root');
      if (!root || !Object.keys(root).some((k) => k.startsWith('__reactContainer$'))) return false;
      const controls = root.querySelectorAll('input, textarea, button, [role="button"], [role="checkbox"], [role="switch"]');
      return Array.from(controls).every((el) => Object.keys(el).some((k) => k.startsWith('__reactProps$')));
    })()`,
    undefined,
    { timeout: 15_000 },
  );
}

/** Makes `goto` and `reload` on `page` wait for hydration. */
function waitsForHydration(page: Page): void {
  const goto = page.goto.bind(page);
  const reload = page.reload.bind(page);
  page.goto = async (...args) => {
    const response = await goto(...args);
    await hydrated(page);
    return response;
  };
  page.reload = async (...args) => {
    const response = await reload(...args);
    await hydrated(page);
    return response;
  };
}

/** Guards a context: every request read for secrets, every page hydrated before use. */
function watch(context: BrowserContext, leaks: Leak[]): void {
  context.on('request', (request) => leaks.push(...leaksIn(request)));
  for (const page of context.pages()) waitsForHydration(page);
  context.on('page', waitsForHydration);
}

export const test = base.extend<{ leaks: Leak[] }>({
  // Every leak so far. A test asks for it only to prove the guard itself works:
  // it can see what was caught, and take it back out.
  leaks: [
    async ({ context, browser }, use) => {
      clearRateCounters();
      const leaks: Leak[] = [];
      watch(context, leaks);

      // Browsers the test opens itself — the email read on another device.
      const newContext = browser.newContext.bind(browser);
      const patched: Browser['newContext'] = async (...args) => {
        const opened = await newContext(...args);
        watch(opened, leaks);
        return opened;
      };
      browser.newContext = patched;

      try {
        await use(leaks);
      } finally {
        browser.newContext = newContext;
      }
      expect(leaks, 'no request carried an invite secret or an emailed token').toEqual([]);
    },
    { auto: true },
  ],
});
