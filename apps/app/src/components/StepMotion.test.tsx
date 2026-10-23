import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Pressable, Text } from 'react-native';
import { describe, expect, it, vi } from 'vitest';

import { Step, useStepMotion } from './StepMotion';

/**
 * The first run's step motion (SUS-247): a step leaves before its navigation
 * runs, a second tap while it leaves does nothing, and a screen that is not a
 * step goes at once.
 */
function Screen({ on, go }: { on: boolean; go: () => void }) {
  const motion = useStepMotion(on);
  return (
    <Step motion={motion}>
      <Pressable role="button" aria-label="Next" onPress={() => motion.leave('forward', go)}>
        <Text>Next</Text>
      </Pressable>
    </Step>
  );
}

describe('a step of the run', () => {
  it('runs the navigation once, after it has left, however many times Next is tapped', async () => {
    const go = vi.fn();
    render(<Screen on go={go} />);
    const next = screen.getByRole('button', { name: 'Next' });
    fireEvent.click(next);
    fireEvent.click(next);
    await waitFor(() => expect(go).toHaveBeenCalledTimes(1));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 300)));
    expect(go).toHaveBeenCalledTimes(1);
  });

  it('goes at once when it is not a step of the run', () => {
    const go = vi.fn();
    render(<Screen on={false} go={go} />);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(go).toHaveBeenCalledTimes(1);
  });

  it('can be left again after it has been left, as a screen under a push is when Back returns', async () => {
    const go = vi.fn();
    render(<Screen on go={go} />);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(go).toHaveBeenCalledTimes(1));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 700)));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(go).toHaveBeenCalledTimes(2));
  });
});
