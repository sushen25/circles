import {
  expect,
  test as base,
  type Browser,
  type BrowserContext,
  type Page,
  type Request,
  type Response,
} from '@playwright/test';

import { clearRateCounters, mint, mintedSecrets } from './stack';

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
 *    and so is every one the server hands a page (`create-circle`,
 *    `get-invite-link`, `rotate-invite`). Every request from every page — the
 *    test's own and any browser it opens with `browser.newContext()` — is read
 *    for them, as it goes and again at the end. A secret in a URL or a header
 *    fails the test wherever it appears; in a body, everywhere but the one call
 *    that exists to receive it, `redeem-invite`. The emailed tokens are held to
 *    the URL and header half (ADR 0023): their bodies go to the function that
 *    spends them. Not guarded: the test's own `request` fixture, which is the
 *    test speaking, not the page.
 * 2. **A page is hydrated before the test touches it.** The web build is
 *    server-rendered (ADR 0001), so a field exists before React owns it, and
 *    WebKit is slow enough to show it: a name typed into the server's HTML is
 *    thrown away when React takes over, and the form then says the field is
 *    empty. `goto` and `reload` wait until React has attached to the page.
 *
 * Rate counters are cleared before each test too: every local request comes
 * from one address, and `redeem_ip` allows ten an hour.
 */

export type Leak = { url: string; where: 'url' | 'header' | 'body' };

/** A request as the guard keeps it: enough to read again once more is known. */
type Seen = { url: string; method: string; body: string; headers: string };

function seen(request: Request): Seen {
  return {
    url: request.url(),
    method: request.method(),
    body: request.postData() ?? '',
    headers: Object.values(request.headers()).join('\n'),
  };
}

/** Every leak, in `request`, of a secret minted so far. */
function leaksIn(request: Seen): Leak[] {
  const leaks: Leak[] = [];
  const { url, body, headers } = request;
  const toRedeem = request.method === 'POST' && new URL(url).pathname.endsWith('/redeem-invite');
  for (const { value, kind } of mintedSecrets()) {
    if (url.includes(value) || url.includes(encodeURIComponent(value))) {
      leaks.push({ url, where: 'url' });
    } else if (headers.includes(value)) {
      leaks.push({ url, where: 'header' });
    } else if (kind === 'invite' && !toRedeem && body.includes(value)) {
      leaks.push({ url, where: 'body' });
    }
  }
  return leaks;
}

/**
 * The functions that hand the page an invite secret the fixtures never saw:
 * a circle made on the first run, its link shown again, its link reset.
 */
const MINTS_A_SECRET = /\/functions\/v1\/(create-circle|get-invite-link|rotate-invite)$/;

/** Registers the secret in a response from one of those, before anything else can use it. */
async function learnSecretFrom(response: Response): Promise<void> {
  if (!MINTS_A_SECRET.test(new URL(response.url()).pathname) || !response.ok()) return;
  try {
    const secret = ((await response.json()) as { invite_secret?: unknown }).invite_secret;
    if (typeof secret === 'string') mint(secret, 'invite');
  } catch {
    // A preflight or an empty body has no secret in it.
  }
}

/** Waits until React has taken over the server-rendered page. */
async function hydrated(page: Page): Promise<void> {
  const waited = page.waitForFunction(
    `(() => {
      const root = document.getElementById('root');
      if (!root || !Object.keys(root).some((k) => k.startsWith('__reactContainer$'))) return false;
      const controls = root.querySelectorAll('input, textarea, button, [role="button"], [role="checkbox"], [role="switch"]');
      return Array.from(controls).every((el) => Object.keys(el).some((k) => k.startsWith('__reactProps$')));
    })()`,
    undefined,
    { timeout: 15_000 },
  );
  await waited.catch((error: unknown) => {
    throw new Error(
      `${page.url()} was not hydrated within 15 s: no React root, or a control React never ` +
        `took over (fixtures.ts waits for this after every goto and reload). ${String(error)}`,
    );
  });
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

/** What one test has seen: its requests, and the leaks found so far. */
type Watch = { seen: Seen[]; found: Leak[]; pending: Promise<void>[] };

/** Guards a context: every request kept and read for secrets, every page hydrated before use. */
function watch(context: BrowserContext, watching: Watch): void {
  context.on('request', (request) => {
    const kept = seen(request);
    watching.seen.push(kept);
    watching.found.push(...leaksIn(kept));
  });
  context.on('response', (response) => {
    watching.pending.push(learnSecretFrom(response));
  });
  for (const page of context.pages()) waitsForHydration(page);
  context.on('page', waitsForHydration);
}

export type Guard = {
  /** Leaks found so far, as each request went out. */
  readonly found: readonly Leak[];
  /** Forgets everything seen so far. Only the guard's own tests call it. */
  forgive(): void;
};

export const test = base.extend<{ guard: Guard }>({
  // A test asks for it only to prove the guard itself works: it can see what
  // was caught, and take it back out.
  guard: [
    async ({ context, browser }, use) => {
      clearRateCounters();
      const watching: Watch = { seen: [], found: [], pending: [] };
      watch(context, watching);

      // Browsers the test opens itself — the email read on another device.
      const newContext = browser.newContext.bind(browser);
      const patched: Browser['newContext'] = async (...args) => {
        const opened = await newContext(...args);
        watch(opened, watching);
        return opened;
      };
      browser.newContext = patched;

      try {
        await use({
          get found() {
            return watching.found;
          },
          forgive() {
            watching.seen.length = 0;
            watching.found.length = 0;
          },
        });
      } finally {
        browser.newContext = newContext;
      }
      // Read everything again now that every secret the server handed out is
      // known: a request that went out before its secret's response had been
      // read would otherwise pass.
      await Promise.all(watching.pending);
      const leaks = watching.seen.flatMap(leaksIn);
      expect(leaks, 'no request carried an invite secret or an emailed token').toEqual([]);
    },
    { auto: true },
  ],
});
