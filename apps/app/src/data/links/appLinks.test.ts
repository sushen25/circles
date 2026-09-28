import { APP_LINK_PATHS } from '@circles/config';
import { DEEP_LINK_ROUTES } from '@circles/contracts';
import { describe, expect, it } from 'vitest';

/**
 * The paths the installed app claims (S3-01a), held to three things that must
 * agree with `APP_LINK_PATHS`: the two well-known files the web host serves,
 * and the router, whose routes they are. The files carry placeholders until
 * S3-01b has a team id and a signing key; this fails if one is filled in by
 * hand here, because the real values are that ticket's, with its validators.
 *
 * That the export serves both as JSON with no redirect is the smoke suite's
 * (`tests/e2e/well-known.spec.ts`), because only a served build can say.
 */

declare global {
  interface ImportMeta {
    glob(pattern: string, options?: Record<string, unknown>): Record<string, unknown>;
  }
}

import { APPLE_APP_SITE_ASSOCIATION } from './wellKnown';

const wellKnown = import.meta.glob('../../../public/.well-known/*', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const routes = [
  ...Object.keys(import.meta.glob('../../../app/**/*.tsx')),
  // `**` does not walk into a dot directory.
  ...Object.keys(import.meta.glob('../../../app/.well-known/*.ts')),
];

function file(name: string): unknown {
  if (name === 'apple-app-site-association') return APPLE_APP_SITE_ASSOCIATION;
  const raw = wellKnown[`../../../public/.well-known/${name}`];
  if (raw === undefined) throw new Error(`public/.well-known/${name} is missing`);
  return JSON.parse(raw);
}

type Aasa = { applinks: { details: { appIDs: string[]; components: { '/': string }[] }[] } };
type AssetLink = {
  relation: string[];
  target: { namespace: string; package_name: string; sha256_cert_fingerprints: string[] };
};

/** `/j/` → `/j/*`: the AASA's spelling of a prefix. */
const aasaPath = (entry: (typeof APP_LINK_PATHS)[number]) =>
  entry.match === 'prefix' ? `${entry.path}*` : entry.path;

/** The route file a claimed path opens: `/j/` → `app/j/[code].tsx`, `/join` → `app/join.tsx`. */
const routeFile = (entry: (typeof APP_LINK_PATHS)[number]) =>
  entry.match === 'prefix'
    ? `../../../app${entry.path}[code].tsx`
    : `../../../app${entry.path}.tsx`;

const ENVS = ['production', 'preview', 'development'];

describe('the well-known files', () => {
  it('are both there, and both JSON — the AASA from its route, assetlinks from public/', () => {
    // Nothing else may claim `.well-known/` (architecture §5.2), and a static
    // AASA there would be served before the route, as octet-stream.
    expect(Object.keys(wellKnown)).toEqual(['../../../public/.well-known/assetlinks.json']);
    expect(routes).toContain('../../../app/.well-known/apple-app-site-association+api.ts');
    expect(() => file('apple-app-site-association')).not.toThrow();
    expect(() => file('assetlinks.json')).not.toThrow();
  });

  it('claim exactly APP_LINK_PATHS for iOS, for every build, behind the TEAMID placeholder', () => {
    const aasa = file('apple-app-site-association') as Aasa;
    expect(aasa.applinks.details).toHaveLength(1);
    const [detail] = aasa.applinks.details;
    expect(detail?.appIDs).toEqual(ENVS.map((env) => `TEAMID.app.circles.${env}`));
    expect(detail?.components.map((c) => c['/'])).toEqual(APP_LINK_PATHS.map(aasaPath));
  });

  it('name every Android build behind the SHA256_FINGERPRINT placeholder', () => {
    const links = file('assetlinks.json') as AssetLink[];
    expect(links.map((l) => l.target.package_name)).toEqual(ENVS.map((e) => `app.circles.${e}`));
    for (const link of links) {
      expect(link.relation).toEqual(['delegate_permission/common.handle_all_urls']);
      expect(link.target.namespace).toBe('android_app');
      expect(link.target.sha256_cert_fingerprints).toEqual(['SHA256_FINGERPRINT']);
    }
  });
});

describe('APP_LINK_PATHS against the router', () => {
  it('opens a route that exists, for every path it claims', () => {
    for (const entry of APP_LINK_PATHS) expect(routes).toContain(routeFile(entry));
  });

  it('covers every link the product sends, and claims none it does not', () => {
    const sent = new Set(
      Object.values(DEEP_LINK_ROUTES).map((route) => {
        const prefix = /^(\/[a-z]+\/):code/.exec(route);
        return prefix === null ? route : prefix[1];
      }),
    );
    expect([...sent].sort()).toEqual(APP_LINK_PATHS.map((entry) => entry.path).sort());
  });
});
