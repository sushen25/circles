import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { brand } from '@circles/config';
import {
  EN_PREVIEW_TEMPLATES,
  EN_SHARE_TEMPLATES,
  ogDescription,
  ogTitle,
  previewCopy,
  withoutLink,
} from '@circles/domain';

import middleware from '../../../app/+middleware';
import { t } from '../../copy';
import { escapeHtml } from '../../data/preview';
import { SITE_HEADERS, sitePage } from './page';
import { START_HREF } from './sections';
import { STUB_FONT_URLS } from '../../test/font-assets-stub';
import { siteFontsFrom } from './styles';
import { useSiteArrival } from './useSiteArrival';

/**
 * The marketing site (SUS-149): what the page says is what the product says,
 * every "Start a plan" goes to the app, nothing leaves the host, and the
 * middleware serves it at `/` without disturbing the link previews.
 */

const ORIGIN = `https://${brand.domain}`;
const FONTS = siteFontsFrom((face) => `/assets/fonts/${face}.0123abcd.woff2`);
const html = sitePage(ORIGIN, FONTS);
/** The page's text as a reader gets it: tags gone, entities decoded. */
const words = html
  .replace(/<style>[\s\S]*?<\/style>/g, '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&#39;/g, "'")
  .replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ');

describe('the chat on the page is the product’s own', () => {
  const circle = t('site', 'circle');
  const url = `${ORIGIN}/p/example`;

  it('is the generated newPlan message, with the link drawn as the card', () => {
    const sent = withoutLink(
      EN_SHARE_TEMPLATES.newPlan({
        circleName: circle,
        windowPhrase: t('site', 'window_phrase'),
        url,
      }),
      url,
    );
    expect(sent).toContain('When can Sunday Crew actually catch up?');
    expect(words).toContain(sent.replace(/\s+/g, ' '));
  });

  it('is the generated lockedIn message', () => {
    const sent = withoutLink(
      EN_SHARE_TEMPLATES.lockedIn({
        circleName: circle,
        date: t('site', 'locked_date'),
        time: t('site', 'locked_time'),
        place: t('site', 'locked_place'),
        url,
      }),
      url,
    );
    expect(words).toContain(escapeHtml(sent).replace(/&#39;/g, "'").replace(/&amp;/g, '&'));
  });

  it('shows the preview card the chat would draw from the link', () => {
    expect(words).toContain(ogTitle(circle, EN_PREVIEW_TEMPLATES));
    expect(words).toContain(ogDescription(EN_PREVIEW_TEMPLATES));
  });

  it('shows the locked-in card under the locked-in message, as the product now draws it', () => {
    const locked = previewCopy(
      { kind: 'p', circleName: circle, planState: 'locked_in' },
      brand.name,
    );
    expect(words).toContain(locked.title);
    expect(words).toContain(locked.description);
  });
});

describe('the page', () => {
  it('sends every Start a plan to the app’s front door, and nowhere else is a CTA', () => {
    const buttons = [...html.matchAll(/<a class="btn[^"]*" href="([^"]+)"/g)].map((m) => m[1]);
    expect(buttons).toHaveLength(5);
    for (const href of buttons) expect(href).toBe(START_HREF);
    expect(START_HREF).toBe('/start?via=site');
  });

  it('has no script, no third-party host and no Google Fonts', () => {
    expect(html).not.toMatch(/<script/i);
    const hosts = [...html.matchAll(/(?:src|href)="(?:https?:)?\/\/([^/"]+)/g)].map((m) => m[1]);
    expect(hosts.filter((host) => host !== brand.domain)).toEqual([]);
    expect(html).not.toMatch(/fonts\.googleapis|gstatic/);
  });

  it('carries its own Open Graph card, title and canonical', () => {
    expect(html).toContain(`<title>${brand.name} — ${brand.descriptor}</title>`);
    expect(html).toContain(`property="og:image" content="${ORIGIN}/og-card.png"`);
    expect(html).toContain(`rel="canonical" href="${ORIGIN}/"`);
    expect(html).toContain('name="viewport"');
  });

  it('links to the real Terms and Privacy pages and the support address', () => {
    expect(html).toContain('href="/terms"');
    expect(html).toContain('href="/privacy"');
    expect(html).toContain(`href="mailto:${brand.supportEmail}"`);
    expect(html).not.toContain('[SUPPORT EMAIL]');
  });

  it('has one h1 and its sections in order', () => {
    expect(html.match(/<h1/g)).toHaveLength(1);
    const ids = [...html.matchAll(/<section[^>]* id="(\w+)"/g)].map((m) => m[1]);
    expect(ids).toEqual(['how', 'privacy', 'organisers']);
  });

  it('names no one’s calendar as a thing it reads, and offers no email capture', () => {
    expect(html).not.toMatch(/<form|<input|type="email"/i);
  });
});

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

describe('useSiteArrival', () => {
  const track = vi.hoisted(() => vi.fn());
  const params = vi.hoisted(() => ({ current: {} as Record<string, string | undefined> }));
  vi.mock('../../analytics/track', () => ({ track }));
  vi.mock('expo-router', () => ({ useLocalSearchParams: () => params.current }));

  beforeEach(() => track.mockClear());

  it('records the click once, with nothing in it, when the app opens from the site', () => {
    params.current = { via: 'site' };
    const { rerender } = renderHook(() => useSiteArrival());
    rerender();
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith('site_start_plan_clicked', {});
  });

  it('records nothing for anyone else', () => {
    params.current = {};
    renderHook(() => useSiteArrival());
    params.current = { via: 'elsewhere' };
    renderHook(() => useSiteArrival());
    expect(track).not.toHaveBeenCalled();
  });
});
