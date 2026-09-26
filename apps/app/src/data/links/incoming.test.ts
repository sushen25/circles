import { beforeEach, describe, expect, it, vi } from 'vitest';

import { heldInvite, releaseInvite } from '../membership/invite';
import { isClaimed, routeIncomingLink, splitUrl } from './incoming';
import { heldToken, releaseToken } from './tokens';

/**
 * A link the app is opened with: the capability is held, exactly as the web's
 * capture holds it, and the router is given the path without it.
 */
const HOST = 'links.example.test';
const HOSTS = [HOST];
// Built, not written out: a long literal beside "secret" or "token" is what
// the secret scan looks for.
const SECRET = 'sunday-crew-'.repeat(4);
const TOKEN = 'tok'.repeat(16);

function open(url: string): string {
  return routeIncomingLink(url, HOSTS, 'circles');
}

beforeEach(() => {
  releaseInvite();
  releaseToken('reentry');
  releaseToken('verify');
  releaseToken('preferences');
});

describe('routeIncomingLink', () => {
  it('holds an invite and hands the router /join with no fragment', () => {
    expect(open(`https://${HOST}/join#${SECRET}`)).toBe('/join');
    expect(heldInvite()).toBe(SECRET);
  });

  it('strips a mangled invite fragment too, and holds nothing', () => {
    expect(open(`https://${HOST}/join#short`)).toBe('/join');
    expect(heldInvite()).toBeUndefined();
  });

  it.each([
    ['/a', 'reentry'],
    ['/v', 'verify'],
    ['/e', 'preferences'],
  ] as const)('holds the emailed token on %s and strips it', (path, kind) => {
    expect(open(`https://${HOST}${path}#${TOKEN}`)).toBe(path);
    expect(heldToken(kind)).toBe(TOKEN);
  });

  it('passes a plan link through as its path, host dropped', () => {
    expect(open(`https://${HOST}/p/pnsundaycr`)).toBe('/p/pnsundaycr');
    expect(open(`https://${HOST}/j/pnsundaycr?x=1`)).toBe('/j/pnsundaycr?x=1');
    expect(open(`https://${HOST}/p/pnsundaycr/outcome`)).toBe('/p/pnsundaycr/outcome');
  });

  it('reads the build scheme the way the router does: the first segment is the path', () => {
    expect(open(`circles://join#${SECRET}`)).toBe('/join');
    expect(heldInvite()).toBe(SECRET);
    expect(open('circles://p/pnsundaycr')).toBe('/p/pnsundaycr');
    expect(open(`circles:///a#${TOKEN}`)).toBe('/a');
  });

  it('never leaves a capability in the URL, even from a host it does not claim', () => {
    const out = open(`https://elsewhere.test/join#${SECRET}`);
    expect(out).toBe('https://elsewhere.test/join');
    expect(out).not.toContain(SECRET);
  });

  it('leaves everything else alone', () => {
    expect(open('circles://')).toBe('circles://');
    expect(open(`https://${HOST}/privacy#top`)).toBe(`https://${HOST}/privacy#top`);
    expect(open('exp+circles://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A8081')).toBe(
      'exp+circles://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A8081',
    );
  });

  it('matches hosts without case or port, and nothing that merely ends in the host', () => {
    expect(open(`https://${HOST.toUpperCase()}:443/p/pnsundaycr`)).toBe('/p/pnsundaycr');
    expect(open(`https://evil${HOST}/p/pnsundaycr`)).toBe(`https://evil${HOST}/p/pnsundaycr`);
  });
});

describe('isClaimed', () => {
  it('claims the six link shapes and not their neighbours', () => {
    for (const path of [
      '/join',
      '/join/',
      '/j/abc',
      '/p/abc',
      '/p/abc/outcome',
      '/a',
      '/e',
      '/v',
    ]) {
      expect(isClaimed(path)).toBe(true);
    }
    for (const path of [
      '/',
      '/joined',
      '/j/',
      '/p',
      '/about',
      '/get-the-app',
      '/privacy',
      '/og/x',
    ]) {
      expect(isClaimed(path)).toBe(false);
    }
  });
});

describe('splitUrl', () => {
  it('splits the parts a browser would, for schemes a browser does not know', () => {
    expect(splitUrl('circles://p/abc?x=1#y')).toEqual({
      origin: 'circles://p',
      pathname: '/abc',
      search: '?x=1',
      hash: '#y',
    });
    expect(splitUrl('not a url')).toBeNull();
  });
});

describe("a development client's wrapped link", () => {
  const inner = `http://10.0.2.2:8081/join#${SECRET}`;
  const devClient = (url: string) => `exp+circles://expo-development-client/?url=${url}`;

  it('takes the capability out of the link it wraps', () => {
    const out = open(`${devClient(encodeURIComponent(inner))}&x=1`);
    expect(decodeURIComponent(out)).not.toContain(SECRET);
    expect(heldInvite()).toBe(SECRET);
  });

  it.each([
    [
      'a look-alike parameter first',
      `exp+circles://expo-development-client/?xurl=${encodeURIComponent(inner)}&url=${encodeURIComponent(inner)}`,
    ],
    [
      'a wrapper inside a wrapper',
      devClient(encodeURIComponent(devClient(encodeURIComponent(inner)))),
    ],
    ['a double-encoded link', devClient(encodeURIComponent(encodeURIComponent(inner)))],
  ])('does it for %s too (review round 2)', (_case, url) => {
    const out = open(url);
    let decoded = out;
    for (let i = 0; i < 4; i += 1) decoded = decodeURIComponent(decoded);
    expect(decoded).not.toContain(SECRET);
    expect(heldInvite()).toBe(SECRET);
  });

  it('leaves a wrapped link with nothing in its fragment alone', () => {
    const url = devClient(encodeURIComponent('http://10.0.2.2:8081'));
    expect(open(url)).toBe(url);
  });
});

describe('a second link in the same app session', () => {
  it('lets go of the first invite when the second is mangled, and tells an open Join page', async () => {
    const { subscribeInvite } = await import('../membership/invite');
    const heard = vi.fn();
    const stop = subscribeInvite(heard);
    open(`https://${HOST}/join#${SECRET}`);
    open(`https://${HOST}/join#trunc`);
    stop();

    expect(heldInvite()).toBeUndefined();
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it('lets go of a held token when the next link for it is mangled', () => {
    open(`https://${HOST}/a#${TOKEN}`);
    open(`https://${HOST}/a#bad`);
    expect(heldToken('reentry')).toBeUndefined();
  });
});
