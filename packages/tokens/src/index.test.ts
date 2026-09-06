import { describe, expect, it } from 'vitest';

import { PACKAGE_NAME } from './index';

describe('@circles/tokens', () => {
  it('is wired into the workspace test runner', () => {
    expect(PACKAGE_NAME).toBe('@circles/tokens');
  });
});
