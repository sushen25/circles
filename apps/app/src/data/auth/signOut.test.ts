import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Signing out has to happen on this device even when the server cannot be
 * reached: a failed global sign-out leaves the stored session in place, and a
 * person on a shared phone who was told they had left would still be in.
 */

const signOut = vi.fn();
vi.mock('./client', () => ({ authClient: () => ({ auth: { signOut } }) }));

const session = await import('./session');
const { readJourney, writeJourney } = await import('./journey');

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

  it('forgets a journey in progress, and the address typed into it, so the next person inherits nothing', async () => {
    signOut.mockResolvedValue({ error: null });
    writeJourney('sent-one-step:abcdef', { email: 'priya@example.com' });

    await session.signOut();

    expect(readJourney('sent-one-step:abcdef')).toBeUndefined();
  });

  it('does not forget it when the sign-out failed: the person is still in', async () => {
    signOut.mockResolvedValue({ error: { message: 'storage' } });
    writeJourney('sent-one-step:abcdef', { email: 'priya@example.com' });

    await expect(session.signOut()).rejects.toThrow();

    expect(readJourney('sent-one-step:abcdef')).toBeDefined();
  });

  it('throws when even the local sign-out failed, so nobody is told they left', async () => {
    signOut.mockResolvedValue({ error: { message: 'storage' } });
    await expect(session.signOut()).rejects.toThrow('sign out failed');
  });
});
