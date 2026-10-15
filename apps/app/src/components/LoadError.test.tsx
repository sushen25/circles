import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LoadError } from './LoadError';

const exit = (onPress = vi.fn()) => ({ label: 'Back to your circles', onPress });

describe('LoadError: the one error block (SUS-200)', () => {
  it('shows the sentence, a small selectable reference, Try again and a second way out', () => {
    const onRetry = vi.fn();
    const onPress = vi.fn();
    render(
      <LoadError
        message="We couldn't load this plan."
        reference="K7M2QX4P"
        exit={exit(onPress)}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText("We couldn't load this plan.")).toBeVisible();
    const reference = screen.getByText('Ref K7M2QX4P');
    expect(reference).toBeVisible();
    expect(reference).not.toHaveStyle({ userSelect: 'none' });

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Back to your circles' }));
    expect(onPress).toHaveBeenCalledOnce();
  });

  it('shows no reference when it was given none: a request that never reached the server', () => {
    render(<LoadError message="You're offline." exit={exit()} onRetry={vi.fn()} />);
    expect(screen.queryByText(/^Ref /)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Back to your circles' })).toBeVisible();
  });

  it('puts a hint under the exit where the real way out is outside the app', () => {
    render(
      <LoadError
        message="We couldn't load this plan."
        exit={{ label: 'Reload this page', onPress: vi.fn() }}
        hint="Still stuck? Open the link from the chat again."
      />,
    );
    expect(screen.getByText('Still stuck? Open the link from the chat again.')).toBeVisible();
  });

  it('asks again for the queries that failed when the screen gave no retry, as Loading does for its waits', async () => {
    const client = new QueryClient();
    const queryFn = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue('fine');
    new QueryObserver(client, { queryKey: ['plan'], queryFn, retry: false }).subscribe(
      () => undefined,
    );
    await waitFor(() => expect(client.getQueryState(['plan'])?.status).toBe('error'));

    render(
      <QueryClientProvider client={client}>
        <LoadError message="We couldn't load this plan." exit={exit()} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2));
  });
});
