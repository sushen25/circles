import { expect, test } from '@playwright/test';

import { APP_LINK_PATHS } from '@circles/config';

/**
 * The two files that let a link on the host open the installed app (S3-01a,
 * architecture §5.2), as the exported build serves them: at their exact
 * paths, as JSON, with no redirect — Apple's CDN and Android's verifier both
 * refuse a redirect, and neither follows one. The values are placeholders
 * until S3-01b; `src/data/links/appLinks.test.ts` holds the shape.
 */
const FILES = ['/.well-known/apple-app-site-association', '/.well-known/assetlinks.json'];

for (const path of FILES) {
  test(`serves ${path} as JSON, with no redirect`, async ({ request }) => {
    const response = await request.get(path, { maxRedirects: 0 });

    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toMatch(/^application\/json/);
    const body = JSON.parse(await response.text()) as unknown;
    expect(body).toBeTruthy();
  });
}

test('the AASA names every claimed path', async ({ request }) => {
  const response = await request.get(FILES[0] as string, { maxRedirects: 0 });
  const text = await response.text();
  for (const entry of APP_LINK_PATHS) {
    expect(text).toContain(`"${entry.match === 'prefix' ? `${entry.path}*` : entry.path}"`);
  }
});
