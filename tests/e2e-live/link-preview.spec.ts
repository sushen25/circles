import { expect, test } from './fixtures';
import { sundayCrew } from './stack';

/**
 * The link card and the page share three paths — `/join`, `/j/<code>`,
 * `/p/<code>` — and `app/+middleware.ts` tells them apart by user agent alone
 * (S1-21). So the user agent is a routing decision, and the two ways it goes
 * wrong are both silent: a person served the card (a page with no app on it,
 * that bounces), or a chat app served the page (a link with no name on it).
 *
 * Asked over HTTP rather than through a page, because the question is what the
 * server answers, before any script runs.
 */

/** A chat app's preview fetcher. Only this ever says "WhatsApp". */
const WHATSAPP_PREVIEW = 'WhatsApp/2.24.16.78 A';
/** Pinterest's in-app browser: a person, whose user agent names the app. */
const PINTEREST_IN_APP =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UQ1A.240105.004; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.179 Mobile Safari/537.36 [Pinterest/Android]';

const isCard = (html: string) =>
  /<meta property="og:title"/.test(html) && !html.includes('id="root"');
const isApp = (html: string) => html.includes('id="root"');

test("this project's browser gets the app on every shared path, never the card", async ({
  request,
}, testInfo) => {
  // Each project is a browser a group chat hands a link to; none of them may
  // look like a preview fetcher. A WhatsApp or Messenger in-app browser whose
  // user agent matched would get a card that refreshes into itself.
  const userAgent = testInfo.project.use.userAgent;
  expect(userAgent, 'every project names its user agent').toBeTruthy();
  const crew = sundayCrew();

  for (const path of ['/join', `/j/${crew.planCode}`, `/p/${crew.planCode}`]) {
    const response = await request.get(path, { headers: { 'user-agent': userAgent! } });
    expect(response.status(), path).toBe(200);
    expect(isApp(await response.text()), `${path} is the app`).toBe(true);
    // Never cached by URL alone: the host ignores `Vary: User-Agent`, so a
    // cached page would be served to the next chat app, or the other way round.
    expect(response.headers()['cache-control'], path).toBe('no-store');
  }
});

test.describe('the preview fetcher', () => {
  // The same answer in every project, so it is asked in one.
  const once = () =>
    test.skip(test.info().project.name !== 'android-chrome', 'the same in every project');

  test('gets a card naming the circle, whichever asks first on a fresh code', async ({
    request,
  }) => {
    once();
    // Both orders, each on its own plan: each was broken at a different point
    // in S1-21 and looked fine from the other direction.
    for (const order of [
      [WHATSAPP_PREVIEW, PINTEREST_IN_APP],
      [PINTEREST_IN_APP, WHATSAPP_PREVIEW],
    ]) {
      const crew = sundayCrew();
      for (const userAgent of order) {
        const response = await request.get(`/j/${crew.planCode}`, {
          headers: { 'user-agent': userAgent },
        });
        const html = await response.text();
        if (userAgent === WHATSAPP_PREVIEW) {
          expect(isCard(html), 'the fetcher gets the card').toBe(true);
          expect(html).toMatch(/<meta property="og:title" content="[^"]*Sunday Crew/);
          expect(response.headers()['cache-control']).toBe('no-store');
          // The card sends a person on to the page, and it is the page's own
          // path: nothing is appended that a re-share would carry.
          expect(html).toContain(`url=${new URL(response.url()).origin}/j/${crew.planCode}">`);
        } else {
          expect(isApp(html), 'an in-app browser gets the app').toBe(true);
        }
      }
    }
  });

  test('gets the generic card for an invite, which names no circle', async ({ request }) => {
    once();
    // The secret is in the fragment, which no request carries, so the server
    // cannot know which circle `/join` is for.
    const response = await request.get('/join', { headers: { 'user-agent': WHATSAPP_PREVIEW } });
    const html = await response.text();
    expect(isCard(html)).toBe(true);
    expect(html).toContain('A circle is finding a time to catch up');
  });
});
