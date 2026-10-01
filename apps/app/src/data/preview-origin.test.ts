import { describe, expect, it } from 'vitest';

import { brand } from '@circles/config';

import { exportedConfig, resolveOrigin, resolveSupabase } from './preview-origin';

const DEPLOYMENT = 'https://x--abc.expo.app';
const PRODUCTION_HOME = `https://${brand.domain}`;
/** Not the brand domain, so a test can tell "configured" from "fell back". */
const CONFIGURED = 'https://configured.test';

function production(appOrigin: unknown) {
  return exportedConfig(JSON.stringify({ extra: { appEnv: 'production', appOrigin } }));
}

describe('exportedConfig', () => {
  it('reads what app.config.ts put in extra', () => {
    const config = exportedConfig(
      JSON.stringify({
        name: brand.name,
        extra: {
          appEnv: 'production',
          appOrigin: CONFIGURED,
          supabaseUrl: 'https://backend.test',
          supabaseAnonKey: 'public-key',
        },
      }),
    );
    expect(config).toEqual({
      appEnv: 'production',
      appOrigin: CONFIGURED,
      supabaseUrl: 'https://backend.test',
      supabaseAnonKey: 'public-key',
    });
  });

  it.each([undefined, '', 'not json', 'null', '"a string"', '{}', '{"extra":null}'])(
    'knows nothing, rather than throwing, from %j',
    (manifest) => {
      expect(exportedConfig(manifest)).toEqual({
        appEnv: null,
        appOrigin: null,
        supabaseUrl: null,
        supabaseAnonKey: null,
      });
    },
  );
});

describe('resolveOrigin in a production build', () => {
  it('uses the exported origin, whatever host the request came in on', () => {
    expect(resolveOrigin(DEPLOYMENT, undefined, production(CONFIGURED))).toBe(CONFIGURED);
  });

  it('ignores a run-time variable, which EAS Hosting does not reliably have', () => {
    expect(resolveOrigin(DEPLOYMENT, DEPLOYMENT, production(CONFIGURED))).toBe(CONFIGURED);
  });

  it('drops a trailing slash, so a card never has `//og-card.png`', () => {
    expect(resolveOrigin(DEPLOYMENT, undefined, production(`${CONFIGURED}/`))).toBe(CONFIGURED);
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['not a URL', brand.domain],
    ['not https', `http://${brand.domain}`],
    ['the vendor host (§5.2)', 'https://sushen25s-team-circles.expo.app'],
    ['a deployment host (§5.2)', DEPLOYMENT],
  ])('falls back to the brand domain when the exported origin is %s', (_, appOrigin) => {
    expect(resolveOrigin(DEPLOYMENT, undefined, production(appOrigin))).toBe(PRODUCTION_HOME);
  });
});

describe('resolveOrigin outside production', () => {
  it.each(['development', 'preview'])('%s keeps the request origin when nothing is set', (env) => {
    const config = exportedConfig(
      JSON.stringify({ extra: { appEnv: env, appOrigin: 'https://elsewhere.test' } }),
    );
    expect(resolveOrigin(DEPLOYMENT, undefined, config)).toBe(DEPLOYMENT);
    expect(resolveOrigin(DEPLOYMENT, '', config)).toBe(DEPLOYMENT);
  });

  it('uses a run-time origin where the server has one', () => {
    expect(resolveOrigin(DEPLOYMENT, 'http://localhost:8082', exportedConfig(undefined))).toBe(
      'http://localhost:8082',
    );
  });

  it('keeps the request origin when nothing was exported at all', () => {
    expect(resolveOrigin(DEPLOYMENT, undefined, exportedConfig(undefined))).toBe(DEPLOYMENT);
  });
});

describe('resolveSupabase', () => {
  const exported = exportedConfig(
    JSON.stringify({ extra: { supabaseUrl: 'https://exported.test', supabaseAnonKey: 'e-key' } }),
  );

  it('prefers a complete run-time pair', () => {
    expect(resolveSupabase({ url: 'https://runtime.test', key: 'r-key' }, exported)).toEqual({
      url: 'https://runtime.test',
      key: 'r-key',
    });
  });

  it('falls back to the exported pair when the server has none', () => {
    expect(resolveSupabase({ url: undefined, key: undefined }, exported)).toEqual({
      url: 'https://exported.test',
      key: 'e-key',
    });
  });

  it('never mixes a URL from one place with a key from the other', () => {
    expect(resolveSupabase({ url: 'https://runtime.test', key: '' }, exported)).toEqual({
      url: 'https://exported.test',
      key: 'e-key',
    });
  });

  it('gives up when neither is complete', () => {
    expect(resolveSupabase({ url: undefined, key: 'r-key' }, exportedConfig(undefined))).toBeNull();
  });
});
