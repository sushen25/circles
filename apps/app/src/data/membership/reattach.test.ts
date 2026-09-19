import { describe, expect, it, vi } from 'vitest';

import { circleNameForCode } from './reattach';

const rpc = vi.fn();
vi.mock('../auth/client', () => ({
  authClient: () => ({ rpc: (...args: unknown[]) => rpc(...args) }),
}));

const CODE = 'pnsundaycr' as never;

describe('circleNameForCode', () => {
  it('answers null only when there is no circle behind the code', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(circleNameForCode(CODE)).resolves.toBeNull();
  });

  it('throws when the lookup itself fails, so offline is not "no such circle"', async () => {
    // Null sends an account's join to the ask-for-the-invite state. A dropped
    // connection answered as null told somebody offline, holding a live plan
    // link, to go and find an invite — with no Retry.
    rpc.mockResolvedValue({ data: null, error: { message: 'Failed to fetch' } });
    await expect(circleNameForCode(CODE)).rejects.toThrow();
  });
});
