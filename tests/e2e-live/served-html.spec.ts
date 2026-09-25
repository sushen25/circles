import { expect, isHydrationError, test, type Page } from './fixtures';
import { accountToSignInTo, latestCodeFor, memberNamed, sundayCrew } from './stack';

/**
 * What the served HTML says before any script runs, and what happens to a
 * person who is quicker than the script (SUS-90, ADR 00XX).
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
  'You need the invite link',
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
      '/v',
      '/',
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

  await expect(page.getByText("Times I'd actually be up for")).toBeVisible();
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
