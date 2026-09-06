import { describe, expect, it } from 'vitest';

import { DEPENDS_ON, PACKAGE_NAME } from './index';

describe('@circles/contracts', () => {
  it('is wired into the workspace test runner', () => {
    expect(PACKAGE_NAME).toBe('@circles/contracts');
  });
});

describe('the dependency rule', () => {
  it('reaches the domain package', () => {
    expect(DEPENDS_ON).toEqual(['@circles/domain']);
  });
});
