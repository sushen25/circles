import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Signing out has to happen on this device even when the server cannot be
 * reached: a failed global sign-out leaves the stored session in place, and a
 * person on a shared phone who was told they had left would still be in.
 */

const signOut = vi.fn();
vi.mock('./client', () => ({ authClient: () => ({ auth: { signOut } }) }));

const session = await import('./session');

beforeEach(() => signOut.mockReset());

describe('signOut', () => {
  it('signs out everywhere when it can', async () => {
    signOut.mockResolvedValue({ error: null });
    await session.signOut();
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('falls back to this device when the server cannot be reached', async () => {
    signOut
      .mockResolvedValueOnce({ error: { message: 'fetch failed' } })
      .mockResolvedValueOnce({ error: null });
    await session.signOut();
    expect(signOut).toHaveBeenLastCalledWith({ scope: 'local' });
  });

  it('throws when even the local sign-out failed, so nobody is told they left', async () => {
    signOut.mockResolvedValue({ error: { message: 'storage' } });
    await expect(session.signOut()).rejects.toThrow('sign out failed');
  });
});
