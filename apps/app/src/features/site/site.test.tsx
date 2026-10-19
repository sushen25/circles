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

import { t } from '../../copy';
import { escapeHtml } from '../../data/preview';
import { sitePage } from './page';
import { START_HREF } from './sections';
import { siteFontsFrom } from './styles';
import { useSiteArrival } from './useSiteArrival';

/**
 * The marketing site (SUS-149): what the page says is what the product says,
 * every "Start a plan" goes to the app and nothing leaves the host. The
 * middleware that serves it at `/` is tested in `src/test/middleware.test.ts`:
 * a feature does not import the routes (architecture §7.2).
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
        weekday: t('site', 'locked_weekday'),
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
