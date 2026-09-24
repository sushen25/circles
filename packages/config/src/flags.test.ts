import { describe, expect, it } from 'vitest';

import { flags } from './index';

describe('flags', () => {
  it('keeps the quiet ask hidden until its server side lands (S2-02, S2-03)', () => {
    expect(flags.quietAsk).toBe(false);
  });
});
