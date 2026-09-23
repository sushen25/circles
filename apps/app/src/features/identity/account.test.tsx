import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Account (S1-23): name and zone, the address shown and nowhere else, the
 * links on, and signing out. No "Delete my account" until S4-05 builds it.
 */

const push = vi.fn();
const replace = vi.fn();
vi.mock('expo-router', () => ({
  useRouter: () => ({ push, replace, back: vi.fn(), canGoBack: () => false }),
}));
vi.mock('../../data/auth/client', () => ({ hasBackend: () => true }));
const session = { status: 'saved', userId: 'maya', isAnonymous: false, isLoading: false };
const saveProfile = vi.fn();
const signOut = vi.fn();
vi.mock('../../data/auth', async () => {
  const { guard } = await import('../../data/auth/guards');
  return {
    guard,
    useSession: () => session,
    ownProfile: () => Promise.resolve({ name: 'Maya', zone: 'Australia/Melbourne' }),
    ownEmail: () => Promise.resolve('maya@example.com'),
    saveProfile: (...a: unknown[]) => saveProfile(...a),
    signOut: () => signOut(),
  };
});
vi.mock('../../data/auth/session', () => ({ useSession: () => session }));

const { AccountFlow } = await import('./AccountFlow');

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
}

beforeEach(() => {
  for (const mock of [push, replace, saveProfile, signOut]) mock.mockReset();
});

describe('account', () => {
  it('shows the name, the address and where the rest lives, and no delete yet', async () => {
    wrap(<AccountFlow />);

    expect(await screen.findByText('maya@example.com')).toBeVisible();
    expect(screen.getByText('Maya')).toBeVisible();
    expect(screen.queryByRole('button', { name: /Delete my account/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /^Privacy\./ }));
    expect(push).toHaveBeenCalledWith('/settings/privacy');
    fireEvent.click(screen.getByRole('button', { name: /^Notifications\./ }));
    expect(push).toHaveBeenCalledWith('/settings/notifications');
  });

  it('changes the name by the domain’s rule, keeping the zone', async () => {
    saveProfile.mockResolvedValue(undefined);
    wrap(<AccountFlow />);

    fireEvent.click((await screen.findAllByRole('button', { name: 'Change' }))[0]!);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  Maya   K ' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    });
    expect(saveProfile).toHaveBeenCalledWith({ name: 'Maya K', zone: 'Australia/Melbourne' });
  });

  it('signs out and goes back to Welcome', async () => {
    signOut.mockResolvedValue(undefined);
    wrap(<AccountFlow />);

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    });
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
  });
});
