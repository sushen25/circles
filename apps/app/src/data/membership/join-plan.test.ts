import { describe, expect, it, vi } from 'vitest';

import type * as functions from '../functions';
import { FunctionError } from '../functions';

const invoke = vi.fn();
vi.mock('../auth/guest', () => ({ ensureGuestSession: vi.fn(async () => ({})) }));
vi.mock('../auth/turnstile', () => ({ getTurnstileToken: vi.fn(async () => undefined) }));
vi.mock('../functions', async (original) => ({
  ...(await original<typeof functions>()),
  invokeFunction: (...args: unknown[]) => invoke(...args),
}));

const { askToPlan } = await import('./join-plan');

const CODE = 'pnsundaycr' as never;
const refused = (reason: string) =>
  new FunctionError({ error: 'x', reason, message: 'x', reference: 'R' } as never, 'x');

describe('askToPlan', () => {
  it('retries a transient failure under one key, since the attempts are one request', async () => {
    // Nobody is watching this happen behind the plan page. Given up after one
    // try, a dropped request left the member to find out when their answer was
    // refused `not_a_participant`.
    invoke
      .mockRejectedValueOnce(new Error('network'))
      .mockRejectedValueOnce(refused('too_many_requests'))
      .mockResolvedValue({});

    await expect(askToPlan(CODE, [0, 0])).resolves.toBe('asked');
    expect(invoke).toHaveBeenCalledTimes(3);
    const keys = invoke.mock.calls.map(
      (call) => (call[1] as { idempotency_key: string }).idempotency_key,
    );
    expect(new Set(keys).size).toBe(1);
    // A member's name is never read, so none is sent.
    expect(invoke.mock.calls[0]?.[1]).not.toHaveProperty('display_name');
  });

  it('stops at once when the plan is not asking: that is an answer, not a failure', async () => {
    invoke.mockReset().mockRejectedValue(refused('invite_inactive'));
    await expect(askToPlan(CODE, [0, 0])).resolves.toBe('closed');
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('says it failed once the retries are spent, so the gate can try again later', async () => {
    invoke.mockReset().mockRejectedValue(new Error('network'));
    await expect(askToPlan(CODE, [0, 0])).resolves.toBe('failed');
    expect(invoke).toHaveBeenCalledTimes(3);
  });
});
