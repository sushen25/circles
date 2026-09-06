import { describe, expect, it } from 'vitest';

import { brand } from './brand';

// These assertions deliberately avoid writing the display name or domain down a
// second time: `brand.ts` is the only place they exist (architecture §5.4), and
// `pnpm check:brand` fails the build if a literal creeps in anywhere else.
describe('brand', () => {
  it('names the product', () => {
    expect(brand.name.length).toBeGreaterThan(0);
    expect(brand.scheme).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it('never ships links on an Expo subdomain', () => {
    expect(brand.domain).not.toMatch(/expo\.app$/);
  });

  it('sends from an authenticated subdomain of the brand domain', () => {
    expect(brand.sender).toContain(`@mail.${brand.domain}>`);
    expect(brand.supportEmail).toContain(`@${brand.domain}`);
  });
});
