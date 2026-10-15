import { describe, expect, it } from 'vitest';

import { devRoutes } from './devRoutes';

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

describe('devRoutes', () => {
  it('shows them in development and in a build with no backend', () => {
    expect(devRoutes({ isDev: true, hasBackend: true, appEnv: 'development' })).toBe('shown');
    expect(devRoutes({ isDev: true, hasBackend: false, appEnv: undefined })).toBe('shown');
    expect(devRoutes({ isDev: false, hasBackend: false, appEnv: undefined })).toBe('shown');
    expect(devRoutes({ isDev: false, hasBackend: false, appEnv: 'preview' })).toBe('shown');
  });

  it('sends them to the front door in a deployed build that has a backend', () => {
    expect(devRoutes({ isDev: false, hasBackend: true, appEnv: 'preview' })).toBe('redirected');
    expect(devRoutes({ isDev: false, hasBackend: true, appEnv: 'development' })).toBe('redirected');
  });

  it('answers not-found in the production environment, with or without a backend', () => {
    expect(devRoutes({ isDev: false, hasBackend: true, appEnv: 'production' })).toBe('not-found');
    expect(devRoutes({ isDev: false, hasBackend: false, appEnv: 'production' })).toBe('not-found');
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
    expect(ROUTE_FILES['/app/(dev)/_layout.tsx']).toMatch(/devRoutes\(/);
  });
});
