import { fireEvent, render, screen } from '@testing-library/react';
import { Component, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { resetClientErrors, setCurrentRoute } from '../../analytics/clientError';
import { bufferedEvents, resetAnalytics } from '../../analytics/track';
import { t } from '../../copy';

import { AppErrorBoundary } from './AppErrorBoundary';

const replace = vi.hoisted(() => vi.fn());
vi.mock('expo-router', () => ({ router: { replace }, useSegments: () => ['p', '[code]'] }));

afterEach(() => {
  resetAnalytics();
  resetClientErrors();
});

/** What Expo Router does around a route that exports `ErrorBoundary`. */
class RouterLike extends Component<
  { retryCount: { n: number }; children: ReactNode },
  { error: Error | null }
> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override render() {
    const { error } = this.state;
    if (error === null) return this.props.children;
    return (
      <AppErrorBoundary
        error={error}
        retry={async () => {
          this.props.retryCount.n += 1;
          this.setState({ error: null });
        }}
      />
    );
  }
}

function Broken(): never {
  throw new TypeError('broke on purpose');
}

describe('AppErrorBoundary', () => {
  it('on a phone, goes home and clears the boundary, so the crash screen does not stay up', async () => {
    const native = await import('react-native');
    const was = native.Platform.OS;
    native.Platform.OS = 'ios';
    const retry = vi.fn(async () => undefined);
    try {
      render(<AppErrorBoundary error={new Error('x')} retry={retry} />);
      fireEvent.click(screen.getByRole('button', { name: t('crash', 'go_home') }));
    } finally {
      native.Platform.OS = was;
    }
    expect(replace).toHaveBeenCalledWith('/');
    expect(retry).toHaveBeenCalledOnce();
  });

  it('shows the error screen with a reference when a screen throws, and reports it once', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    setCurrentRoute(['p', '[code]']);
    render(
      <RouterLike retryCount={{ n: 0 }}>
        <Broken />
      </RouterLike>,
    );
    quiet.mockRestore();

    expect(screen.getByText(t('crash', 'title'))).toBeTruthy();
    const events = bufferedEvents();
    expect(events).toHaveLength(1);
    const reference = events[0]?.properties.reference as string;
    expect(screen.getByText(t('crash', 'reference', { reference }))).toBeTruthy();
    expect(events[0]?.properties).toMatchObject({ route: '/p/:code', source: 'boundary' });
  });

  it('offers Try again, which asks the router to render the screen again', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const retryCount = { n: 0 };
    render(
      <RouterLike retryCount={retryCount}>
        <Broken />
      </RouterLike>,
    );
    quiet.mockRestore();

    fireEvent.click(screen.getByRole('button', { name: t('crash', 'try_again') }));
    expect(retryCount.n).toBe(1);
  });

  it('offers a way home that does not need the router on the web', () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { assign });
    render(<AppErrorBoundary error={new Error('x')} retry={async () => undefined} />);

    fireEvent.click(screen.getByRole('button', { name: t('crash', 'go_home') }));
    expect(assign).toHaveBeenCalledWith('/');
    vi.unstubAllGlobals();
  });
});
