import { describe, expect, it } from 'vitest';

import { devRoutesAvailable } from './devRoutes';

declare global {
  interface ImportMeta {
    glob(
      patterns: string[],
      options: { query: string; import: string; eager: true },
    ): Record<string, string>;
  }
}

/** Every route file's source; `node:fs` is not for the component layer (§7.2). */
const ROUTE_FILES = import.meta.glob(['/app/**/*.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

describe('devRoutesAvailable', () => {
  it('shows them in development and in a build with no backend', () => {
    expect(devRoutesAvailable({ isDev: true, hasBackend: true })).toBe(true);
    expect(devRoutesAvailable({ isDev: true, hasBackend: false })).toBe(true);
    expect(devRoutesAvailable({ isDev: false, hasBackend: false })).toBe(true);
  });

  it('hides them in a production build that has a backend', () => {
    expect(devRoutesAvailable({ isDev: false, hasBackend: true })).toBe(false);
  });
});

describe('fixture routes', () => {
  const files = Object.entries(ROUTE_FILES);

  it('finds the routes', () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files.some(([name]) => name.startsWith('/app/(dev)/'))).toBe(true);
  });

  it('is only ever behind the (dev) guard, or beside a live branch', () => {
    // A route outside `(dev)` that reads `useFixture` must also ask
    // `hasBackend()`, so that with a backend it draws the live flow. One that
    // does not renders another group's name to a real person (SUS-140).
    const offenders = files
      .filter(([name]) => !name.startsWith('/app/(dev)/'))
      .filter(([, source]) => /\buseFixture\b/.test(source) && !/\bhasBackend\(\)/.test(source))
      .map(([name]) => name);
    expect(offenders, 'move these under app/(dev), or give them a live branch').toEqual([]);
  });

  it('has the guard itself in the group', () => {
    expect(Object.keys(ROUTE_FILES)).toContain('/app/(dev)/_layout.tsx');
    expect(ROUTE_FILES['/app/(dev)/_layout.tsx']).toMatch(/devRoutesAvailable/);
  });
});
