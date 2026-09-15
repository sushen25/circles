import { describe, expect, it } from 'vitest';

import {
  CARD_HEADERS,
  destinationFor,
  escapeHtml,
  isPreviewAgent,
  originOf,
  previewCard,
  previewTargetFor,
} from './preview';

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
    expect(html).toContain('Pick the times you&#39;d actually be up for.');
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
  ])('%s is a chat app drawing a preview', (agent) => {
    expect(isPreviewAgent(agent)).toBe(true);
  });

  it.each([
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1',
    'Mozilla/5.0 (Linux; Android 14) Chrome/120.0.0.0 Mobile Safari/537.36',
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

describe('originOf', () => {
  it("falls back to the request's own origin when nothing is configured", () => {
    // `Response.redirect` throws on a relative URL, so an unset variable would
    // turn every human's request into a 500 instead of the app.
    const previous = process.env.EXPO_PUBLIC_APP_ORIGIN;
    delete process.env.EXPO_PUBLIC_APP_ORIGIN;
    try {
      expect(originOf(new URL('https://circles.test/j/pnanaa'))).toBe('https://circles.test');
    } finally {
      if (previous !== undefined) process.env.EXPO_PUBLIC_APP_ORIGIN = previous;
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
