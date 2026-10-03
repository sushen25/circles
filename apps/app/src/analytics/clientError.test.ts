import {
  CLIENT_ERROR_BUILD,
  CLIENT_ERROR_ROUTE_PARAMS,
  CLIENT_ERROR_REFERENCE,
  validateEvent,
} from '@circles/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  MAX_CLIENT_ERRORS_PER_SESSION,
  ROUTE_WORDS,
  errorClassOf,
  listenForClientErrors,
  newReference,
  reportClientError,
  resetClientErrors,
  routePattern,
  setCurrentRoute,
} from './clientError';
import { bufferedEvents, configureAnalytics, resetAnalytics } from './track';

declare global {
  // Vite's, which Vitest runs on; `vite/client` is not a dependency of the app.
  interface ImportMeta {
    glob(
      patterns: string[],
      options: { query: string; import: string; eager: true },
    ): Record<string, string>;
  }
}
/** Every route file; only the paths are read, because `node:fs` is not for the component layer (§7.2). */
const ROUTE_FILES = import.meta.glob(['/app/**/*.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

beforeEach(() => {
  resetAnalytics();
  resetClientErrors();
  configureAnalytics({ now: () => new Date('2026-10-03T00:00:00.000Z') });
});
afterEach(() => {
  resetAnalytics();
  resetClientErrors();
});

const properties = () => bufferedEvents().map((event) => event.properties);

describe('routePattern', () => {
  it('writes a parameter as :name and drops a group', () => {
    expect(routePattern(['p', '[code]'])).toBe('/p/:code');
    expect(routePattern(['(auth)', 'sign-in'])).toBe('/sign-in');
    expect(routePattern(['circles', '[id]', 'plan', '[planId]', 'confirmed'])).toBe(
      '/circles/:id/plan/:planId/confirmed',
    );
    expect(routePattern([])).toBe('/');
    expect(routePattern(['+not-found'])).toBe('/+not-found');
  });

  it('never lets an unknown segment through, whatever it looks like', () => {
    // If a segment ever were the real address, a plan code or an email is not a word of ours.
    expect(routePattern(['p', 'K7QM2X'])).toBe('/p/:other');
    expect(routePattern(['priya@example.com'])).toBe('/:other');
    expect(routePattern(['p', '[priya]'])).toBe('/p/:other');
  });

  it('knows every route in app/, so :other means a real mistake', () => {
    const words = new Set<string>();
    for (const file of Object.keys(ROUTE_FILES)) {
      for (const part of file.replace(/\.(tsx|ts)$/, '').split('/')) {
        if (/^[a-z0-9-]+$/.test(part)) words.add(part);
      }
    }
    words.delete('app');
    const params = new Set<string>();
    for (const file of Object.keys(ROUTE_FILES)) {
      for (const [, name] of file.matchAll(/\[(?:\.\.\.)?([A-Za-z]+)\]/g)) params.add(name!);
    }
    expect(
      [...params].filter((name) => !CLIENT_ERROR_ROUTE_PARAMS.includes(name as never)),
      'add these to CLIENT_ERROR_ROUTE_PARAMS in packages/contracts/src/analytics.ts',
    ).toEqual([]);
    expect(words.size, 'the glob found the routes').toBeGreaterThan(20);
    words.delete('index');
    const missing = [...words].filter((word) => !ROUTE_WORDS.has(word));
    expect(
      missing,
      'add these to CLIENT_ERROR_ROUTE_WORDS in packages/contracts/src/analytics.ts',
    ).toEqual([]);
  });
});

describe('every real route', () => {
  it('has a pattern the catalogue accepts, within its 40 characters, never :other', () => {
    for (const file of Object.keys(ROUTE_FILES).filter((name) => !name.includes('+api'))) {
      const segments = file
        .replace(/^\/app\//, '')
        .replace(/\.(tsx|ts)$/, '')
        .split('/')
        .filter(
          (segment) => segment !== 'index' && !segment.startsWith('+') && !segment.startsWith('_'),
        );
      if (segments.length === 0) continue;
      const route = routePattern(segments);
      expect(route, file).not.toContain(':other');
      expect(route.length, file).toBeLessThanOrEqual(40);
      expect(
        validateEvent('client_error', {
          route,
          error_class: 'other',
          source: 'boundary',
          build: 'dev',
          platform: 'web',
          reference: 'K7QM2X4P',
        }),
        `${file} -> ${route}`,
      ).not.toBeNull();
    }
  });

  it('reports a pattern that would be refused as :other, not cut mid-word', () => {
    expect(routePattern(['circles', '[id]', 'plan', '[planId]', 'change-time', 'candidates'])).toBe(
      '/:other',
    );
  });
});

describe('errorClassOf', () => {
  it('maps a name to a fixed list and everything else to other', () => {
    expect(errorClassOf(new TypeError('x'))).toBe('type_error');
    expect(errorClassOf(new ReferenceError('x'))).toBe('reference_error');
    expect(errorClassOf(new RangeError('x'))).toBe('range_error');
    expect(errorClassOf(new SyntaxError('x'))).toBe('syntax_error');
    expect(errorClassOf(new Error('Loading chunk 12 failed.'))).toBe('chunk_load');
    expect(errorClassOf(new Error('boom'))).toBe('other');
    expect(errorClassOf('a string')).toBe('other');
    expect(errorClassOf(undefined)).toBe('other');
  });
});

describe('newReference', () => {
  it('is eight characters that can be read out, and differs each time', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const reference = newReference();
      expect(reference).toMatch(CLIENT_ERROR_REFERENCE);
      seen.add(reference);
    }
    expect(seen.size).toBeGreaterThan(190);
  });
});

describe('reportClientError', () => {
  it('records the catalogue payload and returns the reference it used', () => {
    setCurrentRoute(['p', '[code]']);
    const reference = reportClientError('boundary', new TypeError('x'));

    expect(properties()).toEqual([
      {
        route: '/p/:code',
        error_class: 'type_error',
        source: 'boundary',
        build: 'dev',
        platform: 'web',
        reference,
      },
    ]);
    const [event] = bufferedEvents();
    expect(validateEvent('client_error', event?.properties)).not.toBeNull();
    expect(CLIENT_ERROR_BUILD.test('dev')).toBe(true);
  });

  it('sends nothing from the error, the address or the fragment', () => {
    // A hostile case on purpose: the page is on a plan link with its fragment,
    // and the error's message, stack and cause all carry a plan code, an
    // address and a name.
    const planCode = 'K7QM2X';
    window.history.replaceState(null, '', `/p/${planCode}#secret-fragment`);
    const error = new TypeError(
      `Cannot read properties of undefined (reading 'priya@example.com')`,
    );
    error.stack = `TypeError at https://wenna.example/p/${planCode}#secret-fragment Priya`;
    (error as { cause?: unknown }).cause = new Error(`Sunday Crew ${planCode}`);

    setCurrentRoute(['p', '[code]']);
    reportClientError('boundary', error);
    reportClientError('window_error', error);

    const wire = JSON.stringify(bufferedEvents());
    for (const forbidden of [
      planCode,
      'secret-fragment',
      'fragment',
      'priya',
      'Priya',
      'example',
      'Sunday',
      'wenna',
      'Cannot read',
    ]) {
      expect(wire, forbidden).not.toContain(forbidden);
    }
    expect(Object.keys(properties()[0] ?? {}).sort()).toEqual([
      'build',
      'error_class',
      'platform',
      'reference',
      'route',
      'source',
    ]);
  });

  it('reports a boundary under the screen it is in, not the one the layout last saw', () => {
    // The layout's last write is the screen the person came from when a screen
    // throws on its first render (review round 2).
    setCurrentRoute(['terms']);
    reportClientError('boundary', new TypeError('x'), ['privacy']);
    expect(properties()[0]).toMatchObject({ route: '/privacy' });
  });

  it('reports the same crash once, and shows its first reference every time after', () => {
    setCurrentRoute(['circles', '[id]']);
    const first = reportClientError('boundary', new TypeError('a'));
    for (let i = 0; i < 1000; i += 1) {
      expect(reportClientError('boundary', new TypeError(`render ${i}`))).toBe(first);
    }
    expect(bufferedEvents()).toHaveLength(1);
  });

  it('caps what one session can send, even for crashes that differ every time', () => {
    const classes = ['type_error', 'reference_error', 'range_error'] as const;
    const makers = [TypeError, ReferenceError, RangeError];
    for (let i = 0; i < 40; i += 1) {
      setCurrentRoute(i % 2 === 0 ? ['circles'] : ['settings']);
      const Maker = makers[i % 3]!;
      reportClientError(i % 4 < 2 ? 'boundary' : 'window_error', new Maker('x'));
    }
    expect(bufferedEvents().length).toBe(MAX_CLIENT_ERRORS_PER_SESSION);
    expect(classes.length).toBe(3);
  });

  it('never throws', () => {
    configureAnalytics({
      now: () => {
        throw new Error('clock');
      },
    });
    expect(() => reportClientError('boundary', new Error('x'))).not.toThrow();
  });
});

describe('listenForClientErrors', () => {
  it('reports a script error and an unhandled rejection, then stops when torn down', () => {
    setCurrentRoute(['settings']);
    const stop = listenForClientErrors();

    window.dispatchEvent(
      Object.assign(new Event('error'), { error: new RangeError('x'), message: 'x' }),
    );
    window.dispatchEvent(
      Object.assign(new Event('unhandledrejection'), { reason: new Error('y') }),
    );

    expect(properties().map((p) => [p.source, p.error_class, p.route])).toEqual([
      ['window_error', 'range_error', '/settings'],
      ['unhandled_rejection', 'other', '/settings'],
    ]);

    stop();
    resetClientErrors();
    setCurrentRoute(['settings']);
    // Nothing of ours is listening now; this keeps the runner from counting the
    // dispatched error as one of the suite's own.
    const swallow = (event: Event): void => event.preventDefault();
    window.addEventListener('error', swallow);
    window.dispatchEvent(
      Object.assign(new Event('error', { cancelable: true }), { error: new TypeError('z') }),
    );
    window.removeEventListener('error', swallow);
    expect(bufferedEvents()).toHaveLength(2);
  });
});
