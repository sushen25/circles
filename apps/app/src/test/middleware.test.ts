import { describe, expect, it } from 'vitest';

import { brand } from '@circles/config';

import middleware from '../../app/+middleware';
import { SITE_HEADERS } from '../features/site/page';
import { STUB_FONT_URLS } from './font-assets-stub';

/**
 * The marketing site as the middleware serves it (SUS-149, SUS-174). This file
 * sits in `src/test/` and not beside the site because it imports the route
 * layer, which a feature never does (architecture §7.2); the page's own tests
 * stay in `features/site/site.test.tsx`.
 */

const ORIGIN = `https://${brand.domain}`;

describe('the site’s fonts are the app’s (SUS-174)', () => {
  const urls = Object.values(STUB_FONT_URLS);

  it('are the WOFF2 files at the app’s own URLs, preloaded, not a second copy', async () => {
    const page = await (await middleware(new Request(`${ORIGIN}/`)))!.text();
    for (const url of [
      STUB_FONT_URLS['Newsreader-Regular'],
      STUB_FONT_URLS['Figtree-Regular'],
      STUB_FONT_URLS['Figtree-SemiBold'],
    ]) {
      expect(page).toContain(
        `<link rel="preload" href="${url}" as="font" type="font/woff2" crossorigin>`,
      );
    }
    for (const url of urls) expect(page).toContain(`url(${url}) format('woff2')`);
    expect(page).not.toMatch(/\.ttf|["(]\/fonts\//);
  });
});

describe('the middleware', () => {
  const get = (path: string, userAgent = 'Mozilla/5.0 (iPhone)', method = 'GET') =>
    middleware(new Request(`${ORIGIN}${path}`, { method, headers: { 'user-agent': userAgent } }));

  it('serves the site at the bare host to a person, with the site’s headers', async () => {
    const response = await get('/');
    expect(response?.status).toBe(200);
    expect(Object.fromEntries(response!.headers)).toMatchObject(
      Object.fromEntries(Object.entries(SITE_HEADERS).map(([k, v]) => [k, v])),
    );
    expect(await response!.text()).toContain('<h1');
  });

  it('cannot be framed and allows no script (SUS-119)', () => {
    expect(SITE_HEADERS['content-security-policy']).toContain("default-src 'none'");
    expect(SITE_HEADERS['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(SITE_HEADERS['permissions-policy']).toContain('geolocation=()');
  });

  it('serves the same site to a link-preview fetcher, and an empty body to HEAD', async () => {
    expect(await (await get('/', 'WhatsApp/2.23'))?.text()).toContain('og:title');
    expect(await (await get('/', 'Mozilla/5.0', 'HEAD'))?.text()).toBe('');
  });

  it('leaves every app route to the app for a person', async () => {
    for (const path of ['/start', '/j/abc', '/p/abc', '/join', '/circles', '/privacy']) {
      expect(await get(path), path).toBeUndefined();
    }
  });

  it('still answers a preview fetcher on the three link shapes', async () => {
    for (const path of ['/j/abc', '/p/abc', '/join']) {
      const response = await get(path, 'WhatsApp/2.23');
      expect(response?.status, path).toBe(200);
      expect(await response!.text(), path).toContain('og:title');
    }
  });
});
