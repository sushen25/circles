import { describe, expect, it } from 'vitest';

import { rememberTypedAddress, typedAddress } from './index';

describe('the typed address (round 1)', () => {
  it('is only ever shown to the person who typed it, not the next one on the same tab', () => {
    rememberTypedAddress('priya', 'plan-1', 'priya@example.com');

    expect(typedAddress('priya', 'plan-1')).toBe('priya@example.com');
    expect(typedAddress('tom', 'plan-1')).toBeUndefined();
  });
});
