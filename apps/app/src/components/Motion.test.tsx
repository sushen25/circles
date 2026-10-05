import { act, render, screen } from '@testing-library/react';
import { Animated, AccessibilityInfo } from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Skeleton } from './Skeleton';
import { Spinner } from './Spinner';

afterEach(() => vi.restoreAllMocks());

async function draw(reduced: boolean) {
  vi.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(reduced);
  const loop = vi.spyOn(Animated, 'loop');
  render(
    <>
      <Skeleton shape="cards" />
      <Spinner color="#000" />
    </>,
  );
  await act(async () => {
    await Promise.resolve();
  });
  return loop;
}

describe('reduced motion', () => {
  it('holds the pulse and the spinner still, and still draws them', async () => {
    await draw(true);
    expect(screen.getByTestId('skeleton')).toHaveStyle({ opacity: '1' });
    expect(screen.getByTestId('spinner').style.transform).toBe('rotate(0deg)');
  });

  it('runs both loops when motion is allowed', async () => {
    const loop = await draw(false);
    // One for the pulse, one for the turn.
    expect(loop.mock.calls.length).toBe(2);
  });
});
