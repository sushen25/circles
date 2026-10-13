import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('../auth/client', () => ({ authClient: () => ({ functions: { invoke } }) }));

const { calendarLink } = await import('./write');

const ID = '00000000-0000-4000-8000-0000000000f1';
const TOKEN = `1790000000.${'A'.repeat(43)}`;

beforeEach(() => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://api.test/';
});
afterEach(() => vi.useRealTimers());

describe('calendarLink', () => {
  it('is the token on the function’s own address, with a deadline on this device’s clock', async () => {
    // A phone an hour ahead of the server: the server's absolute expiry would
    // read as already gone. The deadline is the seconds left, from now.
    vi.useFakeTimers({ now: new Date('2099-01-01T13:00:00Z') });
    invoke.mockResolvedValue({
      data: { token: TOKEN, expires_at: '2099-01-01T12:15:00.000Z', expires_in: 900 },
      error: null,
    });

    const link = await calendarLink(ID);

    expect(invoke).toHaveBeenCalledWith(`generate-ics?confirmation_id=${ID}&format=link`, {
      method: 'GET',
    });
    expect(link?.url).toBe(
      `https://api.test/functions/v1/generate-ics?confirmation_id=${ID}&token=${TOKEN}`,
    );
    expect(link?.expiresAt).toBe(Date.now() + 900_000);
  });

  it('is null when the deployment has no key, so the file is fetched instead', async () => {
    invoke.mockResolvedValue({
      data: { token: null, expires_at: null, expires_in: null },
      error: null,
    });
    expect(await calendarLink(ID)).toBeNull();
  });

  it('is an error when the answer is not what was promised', async () => {
    invoke.mockResolvedValue({ data: { token: 'nope' }, error: null });
    await expect(calendarLink(ID)).rejects.toThrow();
  });
});
