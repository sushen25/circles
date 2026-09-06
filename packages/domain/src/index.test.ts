import { describe, expect, it } from 'vitest';

import { PACKAGE_NAME } from './index';

describe('@circles/domain', () => {
  it('is wired into the workspace test runner', () => {
    expect(PACKAGE_NAME).toBe('@circles/domain');
  });
});
