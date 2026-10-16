import { describe, expect, it } from 'vitest';

import type { EditorState } from './editor';
import { hoursStepShown, rememberHoursStepPushed, shareAnswer, sharedFor } from './hoursStep';

const state = {
  days: [[true]],
  flexible: false,
  window: 'evening',
  open: undefined,
} as EditorState;

describe('the hours step (SUS-209)', () => {
  it('shows only for an address this page load pushed', () => {
    expect(hoursStepShown('hours', 'abc')).toBe(false);
    rememberHoursStepPushed('abc');
    expect(hoursStepShown('hours', 'abc')).toBe(true);
    expect(hoursStepShown(undefined, 'abc')).toBe(false);
    expect(hoursStepShown('hours', 'other')).toBe(false);
  });

  it('hands the answer across for the plan it belongs to only', () => {
    shareAnswer({ key: 'abc', state, touched: true, by: 'first' });
    expect(sharedFor('abc')?.state).toBe(state);
    expect(sharedFor('other')).toBeUndefined();
  });
});
