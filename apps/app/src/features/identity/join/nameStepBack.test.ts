import type { ShortCode } from '@circles/contracts';
import { describe, expect, it } from 'vitest';

import { nameStepBack, nameStepPushed, rememberNameStepPushed } from './nameStepBack';

describe('Back from a plan link name step', () => {
  it('pops to the list when this page pushed the name step', () => {
    expect(nameStepBack({ nobodyToBe: false, pushedHere: true, canGoBack: true })).toBe('pop');
  });

  it('replaces the step with the list when the address was opened on it', () => {
    expect(nameStepBack({ nobodyToBe: false, pushedHere: false, canGoBack: true })).toBe('to_list');
    expect(nameStepBack({ nobodyToBe: false, pushedHere: true, canGoBack: false })).toBe('to_list');
  });

  it('stays on the landing and starts over when nobody is listed, whatever the history', () => {
    for (const pushedHere of [true, false]) {
      for (const canGoBack of [true, false]) {
        expect(nameStepBack({ nobodyToBe: true, pushedHere, canGoBack })).toBe('start_over');
      }
    }
  });

  it('remembers which plan pushed the step', () => {
    expect(nameStepPushed('aaaaaaaaaa' as ShortCode)).toBe(false);
    rememberNameStepPushed('aaaaaaaaaa' as ShortCode);
    expect(nameStepPushed('aaaaaaaaaa' as ShortCode)).toBe(true);
    expect(nameStepPushed('bbbbbbbbbb' as ShortCode)).toBe(false);
  });
});
