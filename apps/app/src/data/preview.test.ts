import { afterEach, describe, expect, it, vi } from 'vitest';

import { brand } from '@circles/config';

import {
  CARD_HEADERS,
  destinationFor,
  escapeHtml,
  isPreviewAgent,
  lookupCircleName,
  originOf,
  previewCard,
  previewTargetFor,
} from './preview';
import { exportedConfig } from './preview-origin';

const ORIGIN = 'https://example.com';

describe('the link-preview card', () => {
  it('names the circle and nothing else about the plan', () => {
    const html = previewCard({
      circleName: 'Sunday Crew',
      target: `${ORIGIN}/j/pnanaa`,
      imageUrl: `${ORIGIN}/og-card.png`,
    });

    expect(html).toContain('Sunday Crew is finding a time to catch up');
    // The card is rendered to a whole thread, including people outside the
    // circle. Nothing about who, when or where may be in it (§5.2).
    expect(html).not.toMatch(/Thursday|Hope St|6:30|Maya|Priya/);
  });

  it('says nothing at all when there is no circle to name', () => {
    const html = previewCard({
      circleName: null,
      target: `${ORIGIN}/join`,
      imageUrl: `${ORIGIN}/og-card.png`,
    });

    expect(html).toContain('A circle is finding a time to catch up');
    // Escaped, apostrophe included — the description is rendered into an
    // attribute, and everything that goes there goes through `escapeHtml`.
    expect(html).toContain('Pick the times you&#39;d be up for.');
  });

  it('names the product as the site, beside the circle rather than instead of it', () => {
    const html = previewCard({
      circleName: 'Sunday Crew',
      target: `${ORIGIN}/j/pnanaa`,
      imageUrl: `${ORIGIN}/og-card.png`,
    });

    expect(html).toContain(`<meta property="og:site_name" content="${brand.name}">`);
    expect(html).toContain(`<meta property="og:image" content="${ORIGIN}/og-card.png">`);
  });

  it('escapes a circle name, which is forty characters somebody chose', () => {
    const html = previewCard({
      circleName: '"><script>alert(1)</script>',
      target: `${ORIGIN}/p/pnanaa`,
      imageUrl: `${ORIGIN}/og-card.png`,
    });

    expect(html).not.toContain('<script>alert(1)');
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
  });

  it('carries the fragment onward without ever having seen it', () => {
    const html = previewCard({
      circleName: 'Sunday Crew',
      target: `${ORIGIN}/join`,
      imageUrl: `${ORIGIN}/og-card.png`,
    });

    // `/join#<secret>` is the one link that grants membership, and its secret
    // is never sent to a server. The redirect reads it from the browser.
    expect(html).toContain('location.hash');
    expect(html).toContain('<meta http-equiv="refresh"');
  });
});

describe('escapeHtml', () => {
  it('closes every hole an attribute has', () => {
    expect(escapeHtml(`& < > " '`)).toBe('&amp; &lt; &gt; &quot; &#39;');
  });
});

describe('who gets a card', () => {
  it.each([
    'WhatsApp/2.23.20.0',
    'facebookexternalhit/1.1',
    'Twitterbot/1.0',
    'Slackbot-LinkExpanding 1.0',
    'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko) Applebot/0.1',
    // iMessage, when it identifies itself at all — see the note on
    // PREVIEW_AGENTS: much of the time it fetches as Safari and cannot be told
    // apart, which is why the durable fix does not test the user agent.
    'com.apple.WebKit.Networking/8617.1.17.10.9 CFNetwork/1474 Darwin/23.0.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 LinkPresentation/1.0',
  ])('%s is a chat app drawing a preview', (agent) => {
    expect(isPreviewAgent(agent)).toBe(true);
  });

  it.each([
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1',
    'Mozilla/5.0 (Linux; Android 14) Chrome/120.0.0.0 Mobile Safari/537.36',
    // An in-app browser is a person. Matching the brand name handed them the
    // card, whose refresh points at the URL it was served on — a blank page
    // reloading for ever, with no way out.
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6) AppleWebKit/605.1.15 Mobile/20A362 [Pinterest/iOS]',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15 Flipboard/4.3.15',
  ])('%s is a person, who wants the app', (agent) => {
    expect(isPreviewAgent(agent)).toBe(false);
  });

  it('treats a missing user agent as a person rather than a fetcher', () => {
    expect(isPreviewAgent(null)).toBe(false);
  });
});

describe('where a tap ends up', () => {
  it('sends a short code to its own route', () => {
    expect(destinationFor(ORIGIN, 'j', 'pnanaa')).toBe(`${ORIGIN}/j/pnanaa`);
    expect(destinationFor(ORIGIN, 'p', 'pnanaa')).toBe(`${ORIGIN}/p/pnanaa`);
  });

  it('sends a circle invite to /join, which resolves its secret in the browser', () => {
    expect(destinationFor(ORIGIN, 'join', null)).toBe(`${ORIGIN}/join`);
    expect(destinationFor(ORIGIN, 'join', 'ignored')).toBe(`${ORIGIN}/join`);
  });

  it('encodes a code rather than trusting it into a URL', () => {
    expect(destinationFor(ORIGIN, 'p', '../../etc')).toBe(`${ORIGIN}/p/..%2F..%2Fetc`);
  });
});

describe('which paths get a card', () => {
  it('recognises the three shapes a shared link can be', () => {
    // These are the paths the share messages actually produce. A card served
    // only at `/og/...` is a card no chat app ever asks for.
    expect(previewTargetFor('/join')).toEqual({ kind: 'join', code: null });
    expect(previewTargetFor('/j/pnanaa')).toEqual({ kind: 'j', code: 'pnanaa' });
    expect(previewTargetFor('/p/pnanaa')).toEqual({ kind: 'p', code: 'pnanaa' });
  });

  it('leaves everything else to the app', () => {
    for (const path of ['/', '/circles', '/j', '/p/', '/join/extra', '/settings/account']) {
      expect(previewTargetFor(path), path).toBeNull();
    }
  });
});

/**
 * The app config as babel-preset-expo inlines it into the server bundle in
 * place of `process.env.APP_MANIFEST` — `app.config.ts`'s output, `extra` and
 * all, as the export evaluated it.
 */
function manifestFor(appEnv: string, appOrigin: string): string {
  return JSON.stringify({
    name: brand.name,
    extra: {
      appEnv,
      appOrigin,
      supabaseUrl: 'https://backend.test',
      supabaseAnonKey: ['anon', 'key', 'for', 'tests'].join('-'),
    },
  });
}

/** Production's custom domain. */
const HOME = `https://${brand.domain}`;

/** The host EAS Hosting hands the server, whatever the person pasted. */
const DEPLOYMENT = new URL('https://sushen25s-team-circles--f0pgx8lb1j.expo.app/j/abc234');

/** Runs `body` with `EXPO_PUBLIC_*` as the server sees them, then restores them. */
function withRuntimeEnv(values: Record<string, string | undefined>, body: () => void): void {
  const previous = Object.fromEntries(Object.keys(values).map((k) => [k, process.env[k]]));
  const apply = (next: Record<string, string | undefined>) => {
    for (const [key, value] of Object.entries(next)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  apply(values);
  try {
    body();
  } finally {
    apply(previous);
  }
}

describe('originOf', () => {
  it("falls back to the request's own origin when nothing is configured", () => {
    // `Response.redirect` throws on a relative URL, so an unset variable would
    // turn every human's request into a 500 instead of the app.
    withRuntimeEnv({ EXPO_PUBLIC_APP_ORIGIN: undefined }, () => {
      expect(originOf(new URL('https://circles.test/j/pnanaa'))).toBe('https://circles.test');
    });
  });

  it('names the production origin on a request that arrived on the deployment host', () => {
    // SUS-128, as production served it: the server had no run-time variable,
    // so the card's image and refresh named `…--f0pgx8lb1j.expo.app`.
    const production = exportedConfig(manifestFor('production', HOME));
    withRuntimeEnv({ EXPO_PUBLIC_APP_ORIGIN: undefined }, () => {
      expect(originOf(DEPLOYMENT, production)).toBe(HOME);
    });
  });

  it('builds a production card on the production origin, image and refresh both', () => {
    const production = exportedConfig(manifestFor('production', HOME));
    withRuntimeEnv({ EXPO_PUBLIC_APP_ORIGIN: undefined }, () => {
      const origin = originOf(DEPLOYMENT, production);
      const html = previewCard({
        circleName: null,
        target: destinationFor(origin, 'j', 'abc234'),
        imageUrl: `${origin}/og-card.png`,
      });
      expect(html).toContain(`<meta property="og:image" content="${HOME}/og-card.png">`);
      expect(html).toContain(`content="0; url=${HOME}/j/abc234"`);
      expect(html).not.toContain('expo.app');
    });
  });

  it('keeps a dev build on the host it was served from', () => {
    const dev = exportedConfig(
      manifestFor('development', 'https://sushen25s-team-circles--dev.expo.app'),
    );
    withRuntimeEnv({ EXPO_PUBLIC_APP_ORIGIN: undefined }, () => {
      expect(originOf(DEPLOYMENT, dev)).toBe(DEPLOYMENT.origin);
    });
  });

  it("keeps a per-PR preview's card on the preview, not on dev", () => {
    // Previews export with dev's origin; their cards must still point at the
    // preview a reviewer is looking at.
    const preview = exportedConfig(
      manifestFor('preview', 'https://sushen25s-team-circles--dev.expo.app'),
    );
    const pr = new URL('https://sushen25s-team-circles--pr-128.expo.app/j/abc234');
    withRuntimeEnv({ EXPO_PUBLIC_APP_ORIGIN: undefined }, () => {
      expect(originOf(pr, preview)).toBe(pr.origin);
    });
  });

  it('still honours a run-time origin outside production, as the local server sets one', () => {
    const dev = exportedConfig(manifestFor('development', 'http://localhost:8081'));
    withRuntimeEnv({ EXPO_PUBLIC_APP_ORIGIN: 'http://localhost:8082' }, () => {
      expect(originOf(new URL('http://127.0.0.1:8082/j/abc234'), dev)).toBe(
        'http://localhost:8082',
      );
    });
  });
});

describe('the name lookup', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks the exported backend when the server has no run-time variables', async () => {
    // Same root cause: on EAS Hosting the lookup had no Supabase URL, so every
    // production card said "A circle" instead of the circle's name.
    const fetchMock = vi.fn(async () => new Response(JSON.stringify('Sunday Crew')));
    vi.stubGlobal('fetch', fetchMock);
    const production = exportedConfig(manifestFor('production', HOME));
    const previous = {
      url: process.env.EXPO_PUBLIC_SUPABASE_URL,
      key: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    };
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    try {
      await expect(lookupCircleName('j', 'pnanaa', production)).resolves.toBe('Sunday Crew');
      expect(fetchMock).toHaveBeenCalledWith(
        'https://backend.test/rest/v1/rpc/preview_for_code',
        expect.objectContaining({ method: 'POST' }),
      );
    } finally {
      if (previous.url !== undefined) process.env.EXPO_PUBLIC_SUPABASE_URL = previous.url;
      if (previous.key !== undefined) process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = previous.key;
    }
  });
});

describe("the card's headers", () => {
  it('forbids a shared cache from storing it at all', () => {
    // Round 2's P0. The card is served at the app's own URL, and EAS Hosting
    // caches a `public` response keyed on the URL alone — `Vary` is not
    // honoured. One fetch by WhatsApp put the card in front of every person
    // who tapped the link afterwards, and the card's refresh points at the URL
    // it was served on, so it reloaded itself for five minutes.
    expect(CARD_HEADERS['cache-control']).toBe('no-store');
    expect(CARD_HEADERS['cache-control']).not.toContain('public');
  });

  it('still says what it varies on, without relying on it', () => {
    expect(CARD_HEADERS['vary']).toBe('User-Agent');
  });

  it('leaks no referrer and lets nothing sniff the type', () => {
    expect(CARD_HEADERS['referrer-policy']).toBe('no-referrer');
    expect(CARD_HEADERS['x-content-type-options']).toBe('nosniff');
  });
});

describe('paths that used to be trouble', () => {
  it('treats /join and /join/ as the same link', () => {
    expect(previewTargetFor('/join/')).toEqual({ kind: 'join', code: null });
  });

  it('answers a broken percent-encoding with no card rather than a 500', () => {
    // A pasted link with a stray `%`. `decodeURIComponent` throws on it.
    expect(previewTargetFor('/p/%E0%A4%A')).toBeNull();
  });
});
