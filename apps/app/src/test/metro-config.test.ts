import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { stubZodLocales, localeName } = require('../../metro/stub-zod-locales') as {
  stubZodLocales: (
    context: { resolveRequest: (...args: unknown[]) => unknown },
    moduleName: string,
    platform: string | null,
  ) => unknown;
  localeName: (filePath: string) => string | null;
};

// Where zod's locales really are, so that a zod release that moves them fails
// here rather than quietly putting 266 KB back in the bundle.
const zodRoot = dirname(require.resolve('zod/package.json'));
const localePath = (name: string) => join(zodRoot, 'v4', 'locales', `${name}.js`);

/** A resolver that answers every request with this file, as Metro's would. */
const resolvesTo = (filePath: string) => ({
  resolveRequest: () => ({ type: 'sourceFile', filePath }),
});

describe('the Metro resolver that stubs zod locales (SUS-174)', () => {
  it('zod keeps its locales where the resolver looks', () => {
    for (const name of ['en', 'de', 'index']) expect(existsSync(localePath(name))).toBe(true);
    expect(localeName(localePath('de'))).toBe('de');
  });

  it('resolves a locale that is not used to an empty module', () => {
    expect(stubZodLocales(resolvesTo(localePath('de')), './de.js', 'web')).toEqual({
      type: 'empty',
    });
  });

  it('leaves en, and the index that re-exports the rest, as the real modules', () => {
    for (const name of ['en', 'index']) {
      expect(stubZodLocales(resolvesTo(localePath(name)), `./${name}.js`, 'web')).toEqual({
        type: 'sourceFile',
        filePath: localePath(name),
      });
    }
  });

  it('leaves every other module alone, whatever its name', () => {
    for (const filePath of [
      join(zodRoot, 'v4', 'core', 'index.js'),
      join(zodRoot, 'v4', 'locales-of-something', 'de.js'),
      '/src/features/locales/de.js',
    ]) {
      expect(stubZodLocales(resolvesTo(filePath), 'x', 'web')).toEqual({
        type: 'sourceFile',
        filePath,
      });
    }
  });

  it('passes an unresolved request through', () => {
    const empty = { type: 'empty' };
    expect(stubZodLocales({ resolveRequest: () => empty }, 'x', null)).toBe(empty);
  });
});

describe('the Metro resolver that picks the web fonts (SUS-174)', () => {
  const { fontModuleFor } = require('../../metro/web-font-assets') as {
    fontModuleFor: (moduleName: string, platform: string | null) => string;
  };

  it('names the WOFF2 module on web, the pre-render included', () => {
    expect(fontModuleFor('@circles/tokens/font-assets', 'web')).toBe(
      '@circles/tokens/font-assets.web',
    );
  });

  it('leaves native on the TrueType module, and every other request alone', () => {
    for (const platform of ['ios', 'android']) {
      expect(fontModuleFor('@circles/tokens/font-assets', platform)).toBe(
        '@circles/tokens/font-assets',
      );
    }
    expect(fontModuleFor('@circles/tokens', 'web')).toBe('@circles/tokens');
  });
});
