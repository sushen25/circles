import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { tap } from '../../test/tap';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Account (S1-23, S4-05): name and zone, the address shown and nowhere else,
 * the links on, downloading your data, signing out, and deleting the account in
 * two steps.
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
const deleteMyAccount = vi.fn();
const deletionPreview = vi.fn();
const exportMyData = vi.fn();
const saveFile = vi.fn();
vi.mock('../../platform/download', () => ({ saveFile: (...a: unknown[]) => saveFile(...a) }));
vi.mock('../../data/auth', async () => {
  const { guard } = await import('../../data/auth/guards');
  return {
    guard,
    useSession: () => session,
    ownProfile: () => Promise.resolve({ name: 'Maya', zone: 'Australia/Melbourne' }),
    ownEmailHint: () => Promise.resolve('m…@example.com'),
    saveProfile: (...a: unknown[]) => saveProfile(...a),
    signOut: () => signOut(),
    deleteMyAccount: (...a: unknown[]) => deleteMyAccount(...a),
    deletionPreview: () => deletionPreview(),
    exportMyData: () => exportMyData(),
  };
});
vi.mock('../../data/auth/session', () => ({ useSession: () => session }));

const { AccountFlow } = await import('./AccountFlow');

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
}

beforeEach(() => {
  for (const mock of [
    push,
    replace,
    saveProfile,
    signOut,
    deleteMyAccount,
    deletionPreview,
    exportMyData,
    saveFile,
  ])
    mock.mockReset();
  deletionPreview.mockResolvedValue([]);
});

describe('account', () => {
  it('shows the name, a hint of the address and where the rest lives', async () => {
    wrap(<AccountFlow />);

    expect(await screen.findByText('m…@example.com')).toBeVisible();
    expect(screen.queryByText('maya@example.com')).toBeNull();
    expect(screen.getByText('Maya')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Delete my account and data' })).toBeVisible();

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

  it('stays put and says so when signing out did not happen', async () => {
    signOut.mockRejectedValue(new Error('sign out failed'));
    wrap(<AccountFlow />);

    await act(async () => {
      await tap(screen.findByRole('button', { name: 'Sign out' }));
    });
    expect(await screen.findByText("You're still signed in. Try again.")).toBeVisible();
    expect(replace).not.toHaveBeenCalled();
  });

  it('signs out and goes back to Welcome', async () => {
    signOut.mockResolvedValue(undefined);
    wrap(<AccountFlow />);

    await act(async () => {
      await tap(screen.findByRole('button', { name: 'Sign out' }));
    });
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
  });

  it('deletes in two steps, and only the second does it', async () => {
    deleteMyAccount.mockResolvedValue({ handedOn: 0, archived: 0 });
    wrap(<AccountFlow />);

    fireEvent.click(await screen.findByRole('button', { name: 'Delete my account and data' }));
    expect(await screen.findByText('Delete your account?')).toBeVisible();
    expect(screen.getByText(/Former member/)).toBeVisible();
    expect(deleteMyAccount).not.toHaveBeenCalled();

    await waitFor(() => expect(deletionPreview).toHaveBeenCalled());
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText("This can't be undone")).toBeVisible();
    expect(deleteMyAccount).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
    });
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/deleted'));
    expect(deleteMyAccount).toHaveBeenCalledTimes(1);
  });

  it('tells an owner where each circle goes before asking', async () => {
    deletionPreview.mockResolvedValue([
      { circleId: 'c1', name: 'Sunday Crew', heirName: 'Nina' },
      { circleId: 'c2', name: 'Book Club', heirName: null },
    ]);
    wrap(<AccountFlow />);

    fireEvent.click(await screen.findByRole('button', { name: 'Delete my account and data' }));
    expect(
      await screen.findByText(
        'Sunday Crew goes to Nina, the saved-place member who has been in it longest.',
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        'Book Club has nobody to hand it to, so it is archived now and deleted with your account.',
      ),
    ).toBeVisible();
  });

  it('says so, and stays, when the account was not deleted', async () => {
    deleteMyAccount.mockRejectedValue(new Error('delete-account failed'));
    wrap(<AccountFlow />);

    fireEvent.click(await screen.findByRole('button', { name: 'Delete my account and data' }));
    await waitFor(() => expect(deletionPreview).toHaveBeenCalled());
    await act(async () => {});
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Delete my account' }));
    });
    expect(
      await screen.findByText(
        "We couldn't delete your account, and nothing has changed. Try again.",
      ),
    ).toBeVisible();
    expect(replace).not.toHaveBeenCalled();
  });

  it('downloads the data as a file', async () => {
    exportMyData.mockResolvedValue({ filename: 'wenna-my-data-2026-10-20.json', contents: '{}' });
    saveFile.mockReturnValue('saved');
    wrap(<AccountFlow />);

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /^Download my data\./ }));
    });
    expect(saveFile).toHaveBeenCalledWith(
      '{}',
      'wenna-my-data-2026-10-20.json',
      'application/json',
    );
    expect(
      await screen.findByText(/Downloaded\. You can download your data once a day/),
    ).toBeVisible();
  });
});
