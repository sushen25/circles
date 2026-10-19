import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * `/_sitemap` lists every route, including the dev gallery and the founder's
 * screens. It belongs on a laptop and nowhere that is deployed.
 */

async function expoRouterOptions(appEnv: string): Promise<Record<string, unknown>> {
  vi.resetModules();
  vi.stubEnv('EXPO_PUBLIC_APP_ENV', appEnv);
  const { default: config } = await import('../../app.config');
  const plugin = (config.plugins ?? []).find(
    (entry): entry is [string, Record<string, unknown>] =>
      Array.isArray(entry) && entry[0] === 'expo-router',
  );
  if (plugin === undefined) throw new Error('expo-router is not configured');
  return plugin[1];
}

afterEach(() => vi.unstubAllEnvs());

describe('the sitemap route', () => {
  it('ships on the local dev server', async () => {
    expect((await expoRouterOptions('development'))['sitemap']).toBe(true);
  });

  it.each(['preview', 'production'])('is left out of a %s export', async (appEnv) => {
    expect((await expoRouterOptions(appEnv))['sitemap']).toBe(false);
  });
});
