// @e2e: locale
import { createHash } from 'node:crypto';

import { expect, isCspViolation, isHydrationError, test, type Page } from './fixtures';
import { accountToSignInTo, latestCodeFor, memberNamed, stackConfig, sundayCrew } from './stack';

/**
 * What the served HTML says before any script runs, and what happens to a
 * person who is quicker than the script (SUS-90, ADR 0040).
 *
 * Every page is rendered once, at export, for every visitor at once, so the
 * HTML is a neutral shell on every route: no refusal it cannot know is true, no
 * date in the export machine's locale, no field to type into before React owns
 * it. The first half asks the server over HTTP, as the link-preview spec does,
 * because the question is what a person on a slow phone sees first. The second
 * half holds the scripts back and types the moment a field can be typed into.
 */

/** Copy a refusal is written in. None of it may be in HTML that knows nobody. */
const REFUSALS = [
  "This plan isn't taking new answers",
  "You're not in this circle",
  'Open the invite link again',
  'This link has expired',
  "This link isn't active any more",
  'Open the link from your email again',
];

/** The body's visible text, scripts and styles left out. */
function bodyText(html: string): string {
  const body = html.slice(html.indexOf('<body'));
  return body
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Holds every script back, so the served HTML stays on screen for a while. */
async function slowScripts(page: Page, ms: number): Promise<void> {
  await page.route('**/*.js', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    await route.continue();
  });
}

test.describe('the served HTML', () => {
  // The same bytes in every project: the server does not look at the browser.
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'android-chrome', 'the same in every project');
  });

  test('is the shell on every gated route and every route with a field', async ({ request }) => {
    const crew = sundayCrew();
    const paths = [
      `/p/${crew.planCode}`,
      `/j/${crew.planCode}`,
      '/join',
      '/join/name',
      `/p/${crew.planCode}/confirmed`,
      `/j/${crew.planCode}/sent`,
      '/sign-in',
      '/circles',
      '/circles/new',
      '/a',
      '/e',
      '/n',
      '/o',
      '/q',
      '/v',
      '/start',
    ];
    for (const path of paths) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(200);
      const html = await response.text();
      const text = bodyText(html);
      expect(text, `${path} serves the shell`).toBe('Getting things ready');
      for (const refusal of REFUSALS) expect(text, path).not.toContain(refusal);
      expect(html, `${path} has no field before React owns it`).not.toMatch(/<(input|textarea)\b/);
    }
  });
});

test('the bare host is the site, in the served HTML, with no shell and no script', async ({
  request,
}) => {
  const response = await request.get('/');
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(html).toContain('<h1');
  expect(html).not.toContain('Getting things ready');
  expect(html).not.toMatch(/<script/i);
  expect(html).not.toMatch(/<(input|textarea)\b/);
  // It carries its own headers (SUS-119): no script to allow, and no framing.
  const headers = response.headers();
  expect(headers['content-security-policy']).toContain("default-src 'none'");
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(headers['permissions-policy']).toContain('camera=()');
});

test('a name typed the moment the field appears is the name that is sent', async ({ page }) => {
  // Maya has a saved place, so there is nobody to continue as: `/j/<code>` goes
  // straight to the name step, the field a guest meets first. Before SUS-90
  // this page served a refusal rather than the field, so what failed here was
  // the #418 (the guard's); the email test below is the one whose field used
  // to be in the HTML.
  const crew = sundayCrew();
  await slowScripts(page, 1_500);

  await page.goto(`/j/${crew.planCode}`, { waitUntil: 'commit' });
  // No wait for hydration (there is none in `fixtures.ts` any more): the
  // moment Playwright can type into a field, it does, as a fast thumb would.
  const name = page.getByLabel('Your name');
  await name.pressSequentially('Ren');
  await expect(name, 'what was typed is still in the field').toHaveValue('Ren');
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByText('Which evenings could work?')).toBeVisible();
  expect(memberNamed(crew.circleId, 'Ren'), 'the name typed is the name joined').toBeDefined();
});

test('an email typed the moment the field appears is the address the code goes to', async ({
  page,
}) => {
  // The case WebKit found (S1-31): `/sign-in` used to serve its field in the
  // HTML, and what was typed there was gone once React took over.
  const { email } = await accountToSignInTo('Maya');
  await slowScripts(page, 1_500);

  await page.goto('/sign-in', { waitUntil: 'commit' });
  const field = page.getByLabel('Your email');
  await field.pressSequentially(email);
  await expect(field, 'what was typed is still in the field').toHaveValue(email);
  await page.getByRole('button', { name: 'Send me a code' }).click();

  // The code step names the address typed. Before SUS-90 the form said the
  // field was empty here instead, and no code went anywhere.
  await expect(
    page.getByText(`Sent to ${email}.`, { exact: false }),
    'the code step, for the address typed',
  ).toBeVisible();
  expect(await latestCodeFor(email)).toMatch(/^\d{6}$/);
});

/** The text of every inline `<script>` in `html`. */
function inlineScripts(html: string): string[] {
  return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
    (match) => match[1] ?? '',
  );
}

test.describe('the security headers', () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'android-chrome', 'the same in every project');
  });

  // The routes whose HTML the router wrote: the three that carry a secret, the
  // front door, a gated screen and the not-found page.
  const pages = (): string[] => {
    const crew = sundayCrew();
    return [`/p/${crew.planCode}`, `/j/${crew.planCode}`, '/join', '/start', '/sign-in', '/nope'];
  };

  test('every page carries a policy, nosniff and a permissions policy (SUS-119)', async ({
    request,
  }) => {
    for (const path of pages()) {
      const response = await request.get(path);
      const headers = response.headers();
      const policy = headers['content-security-policy'] ?? '';
      expect(policy, `${path} has a policy`).not.toBe('');
      expect(headers['x-content-type-options'], path).toBe('nosniff');
      expect(headers['permissions-policy'], path).toBe('camera=(), microphone=(), geolocation=()');
      expect(headers['referrer-policy'], path).toBe('no-referrer');
      // The ones that are what the policy is for.
      expect(policy, path).toContain("frame-ancestors 'none'");
      expect(policy, path).toContain("default-src 'self'");
      expect(policy, path).not.toContain('unsafe-eval');
      expect(policy.match(/script-src[^;]*/)?.[0], path).not.toContain("'unsafe-inline'");
    }
  });

  test('allows the backend the page was built for, and Turnstile', async ({ request }) => {
    const policy = (await request.get('/start')).headers()['content-security-policy'] ?? '';
    const backend = new URL(stackConfig().apiUrl);
    expect(policy.match(/connect-src[^;]*/)?.[0]).toContain(backend.origin);
    expect(policy.match(/script-src[^;]*/)?.[0]).toContain('https://challenges.cloudflare.com');
    expect(policy.match(/frame-src[^;]*/)?.[0]).toContain('https://challenges.cloudflare.com');
  });

  // The hash in the policy is computed from a constant in `@circles/config`.
  // This reads the script out of the HTML the router actually wrote, so a router
  // that changes it fails here, not as a blank page in production.
  test('allows exactly the inline script the router wrote, by its hash', async ({ request }) => {
    for (const path of pages()) {
      const response = await request.get(path);
      const policy = response.headers()['content-security-policy'] ?? '';
      const scripts = inlineScripts(await response.text());
      expect(scripts.length, `${path} has its hydrate script`).toBeGreaterThan(0);
      for (const script of scripts) {
        const hash = `sha256-${createHash('sha256').update(script).digest('base64')}`;
        expect(
          policy,
          `${path}: the policy allows the inline script ${script.slice(0, 40)}`,
        ).toContain(`'${hash}'`);
      }
    }
  });

  test('the guard knows a policy violation when the console reports one', () => {
    test.skip(test.info().project.name !== 'android-chrome', 'no browser involved');
    expect(
      isCspViolation(
        'Refusing to execute inline script because it violates the following Content Security Policy directive: "script-src \'self\'".',
      ),
    ).toBe(true);
    expect(isCspViolation('csp-violation: script-src-elem https://example.com/x.js')).toBe(true);
    expect(
      isCspViolation('Failed to load resource: the server responded with a status of 404'),
    ).toBe(false);
  });
});

test('the guard knows every way React reports a failed hydration', () => {
  test.skip(test.info().project.name !== 'android-chrome', 'no browser involved');
  // As a production build throws them, and as a development build words them.
  for (const code of [418, 419, 421, 422, 423, 424, 425]) {
    expect(
      isHydrationError(
        `Error: Minified React error #${code}; visit https://react.dev/errors/${code}`,
      ),
      `#${code}`,
    ).toBe(true);
  }
  expect(
    isHydrationError(
      'Error: This root received an early update, before anything was able hydrate. Switched the entire root to client rendering.',
    ),
  ).toBe(true);
  expect(
    isHydrationError(
      "Error: Hydration failed because the server rendered text didn't match the client.",
    ),
  ).toBe(true);
  // Not every page error is one: a React error about something else is not.
  expect(
    isHydrationError('Error: Minified React error #185; visit https://react.dev/errors/185'),
  ).toBe(false);
});
