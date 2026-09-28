import { describe, expect, it } from 'vitest';

import { APP_LINK_PATHS } from './links';

describe('APP_LINK_PATHS', () => {
  it('claims the six link shapes the product sends, and nothing else', () => {
    expect(APP_LINK_PATHS.map((entry) => entry.path)).toEqual([
      '/join',
      '/j/',
      '/p/',
      '/a',
      '/e',
      '/v',
    ]);
  });

  it('ends every prefix at a slash, so /join is never claimed as a /j prefix', () => {
    for (const entry of APP_LINK_PATHS) {
      if (entry.match === 'prefix') expect(entry.path.endsWith('/')).toBe(true);
      else expect(entry.path.endsWith('/')).toBe(false);
    }
  });
});
